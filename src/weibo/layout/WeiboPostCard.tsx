/**
 * 时间线卡片：作者头像、正文（含表情）、转发摘要、配图九宫格、互动数据与评论区。
 * 复用约定：数据是归一化后的 WeiboTimelinePost，图片地址已在宿主按白名单收窄；
 * 头像与富文本分别交给 WeiboAvatar / WeiboRichText，配图与灯箱在本文件内；
 * 所有图片都经 useWeiboImage 换成本地地址——图床按 Referer 放行，Webview 直连会被拒。
 * 关键约束：hooks 只能在组件内调用，故表情、配图、点赞各自抽成子组件，不能在 map 里直接调；
 * 图片按「进入视口附近」才发起下载；评论区按需展开，未展开不请求。
 */
import { cn } from 'cn'
import { format } from 'date-fns'
import { BadgeCheck, ExternalLink, Heart, ImageIcon, ImageOff, MessageCircle, Repeat2, Video } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Card, CardContent } from '@components/ui/card'
import type {
    WeiboLikeResult,
    WeiboLongTextResult,
    WeiboTimelineImageSize,
    WeiboTimelinePost,
    WeiboTimelineSegment,
} from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboCommentList } from './WeiboCommentList'
import { WeiboLightbox } from './WeiboLightbox'
import { WeiboRichText } from './WeiboRichText'
import type { JSX } from 'react'
import { useHasEnteredViewport } from '../hooks/useHasEnteredViewport'
import { useWeiboImage } from '../hooks/useWeiboImage'

/** 九宫格上限：与微博前端一致，超出部分只在原文可见 */
const MAX_GRID_IMAGES = 9

/** 发布时间：同一年省掉年份，解析失败回退上游原串 */
function formatPostTime(post: WeiboTimelinePost): string {
    if (post.createdAt.length === 0) {
        return post.createdAtRaw
    }
    const date = new Date(post.createdAt)
    if (Number.isNaN(date.getTime())) {
        return post.createdAtRaw
    }
    const isSameYear = date.getFullYear() === new Date().getFullYear()
    return format(date, isSameYear ? 'MM-dd HH:mm' : 'yyyy-MM-dd HH:mm')
}

interface WeiboImageProps {
    remoteUrl: string
    alt: string
    className?: string
}

/** 配图：进入视口后才下载，就绪前用同尺寸脉冲占位，解码失败也标出破图 */
function WeiboImage({ remoteUrl, alt, className }: WeiboImageProps): JSX.Element | null {
    const { ref, hasEntered } = useHasEnteredViewport()
    const { localUrl, isFailed } = useWeiboImage(hasEntered ? remoteUrl : '')
    const [isBroken, setIsBroken] = useState(false)

    const handleError = useCallback((): void => {
        setIsBroken(true)
    }, [])

    if (isFailed || isBroken) {
        // 失败保留同尺寸占位并标出破图，避免用户把「下载失败」误判成「这条没有图」
        return (
            <span className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
                <ImageOff className="size-4" aria-hidden="true" />
            </span>
        )
    }
    if (localUrl === null) {
        return <span ref={ref} aria-hidden className={cn('block animate-pulse bg-muted', className)} />
    }
    return <img src={localUrl} alt={alt} className={className} loading="lazy" onError={handleError} />
}

interface LikeButtonProps {
    /** 微博数字 id：点赞接口的入参 */
    postId: string
    initialLiked: boolean
    initialCount: number
}

/**
 * 点赞按钮：乐观更新点赞态与计数，失败回滚并提示。
 * 关键约束：写操作不能被连点放大——请求进行中直接丢弃点击（ref 判定，避免闭包读到旧 state）。
 */
function LikeButton({ postId, initialLiked, initialCount }: LikeButtonProps): JSX.Element {
    const [isLiked, setIsLiked] = useState(initialLiked)
    const [count, setCount] = useState(initialCount)
    const [isPending, setIsPending] = useState(false)
    const isPendingRef = useRef(false)

    const handleClick = useCallback((): void => {
        if (isPendingRef.current) {
            return
        }
        isPendingRef.current = true
        setIsPending(true)
        const willLike = !isLiked
        setIsLiked(willLike)
        setCount((previous) => Math.max(0, previous + (willLike ? 1 : -1)))
        void request<WeiboLikeResult>('weibo/like', { id: postId, liked: willLike }, 20_000)
            .then((result) => {
                setIsLiked(result.liked)
                if (result.attitudesCount !== null) {
                    setCount(result.attitudesCount)
                }
            })
            .catch((cause: unknown) => {
                // 回滚到点击前的状态，避免界面与服务端不一致
                setIsLiked(!willLike)
                setCount((previous) => Math.max(0, previous + (willLike ? -1 : 1)))
                toastError(cause)
            })
            .finally(() => {
                isPendingRef.current = false
                setIsPending(false)
            })
    }, [isLiked, postId])

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            aria-pressed={isLiked}
            aria-label={isLiked ? '取消赞' : '赞'}
            className={cn(
                'flex items-center gap-1 transition-colors hover:text-foreground disabled:opacity-60',
                isLiked && 'text-primary',
            )}
        >
            <Heart className="size-3.5" fill={isLiked ? 'currentColor' : 'none'} aria-hidden="true" />
            {count}
        </button>
    )
}

interface WeiboPostCardProps {
    post: WeiboTimelinePost
}

export function WeiboPostCard({ post }: WeiboPostCardProps): JSX.Element {
    const handleOpen = useCallback((): void => {
        void request('weibo/openPost', { url: post.url }).catch(toastError)
    }, [post.url])

    /** 原图预览：点击九宫格时才取原图，列表始终用中等尺寸；尺寸随预览一起带上 */
    const [preview, setPreview] = useState<{
        origin: string
        thumb: string
        size: WeiboTimelineImageSize | null
    } | null>(null)
    const [isCommentsOpen, setIsCommentsOpen] = useState(false)
    /** 长文全文：展开后替换摘要，卡片保持展开态直到列表重建 */
    const [fullText, setFullText] = useState<string | null>(null)
    const [isExpanding, setIsExpanding] = useState(false)

    const handlePreviewClose = useCallback((): void => {
        setPreview(null)
    }, [])

    const toggleComments = useCallback((): void => {
        setIsCommentsOpen((previous) => !previous)
    }, [])

    /** 展开全文：mblogid 优先（长文接口按它取），缺失才用数字 id */
    const handleExpand = useCallback((): void => {
        if (isExpanding) {
            return
        }
        setIsExpanding(true)
        const targetId = post.mblogid.length > 0 ? post.mblogid : post.id
        void request<WeiboLongTextResult>('weibo/longtext', { id: targetId }, 20_000)
            .then((result) => {
                setFullText(result.text)
            })
            .catch(toastError)
            .finally(() => {
                setIsExpanding(false)
            })
    }, [isExpanding, post.id, post.mblogid])

    /** 正文分段：展开全文后整段替换为接口返回的纯文本 */
    const bodySegments: WeiboTimelineSegment[] = fullText === null ? post.segments : [{ type: 'text', text: fullText }]

    const images = post.media.images.slice(0, MAX_GRID_IMAGES)
    const thumbnails = post.media.thumbnails
    const gridClassName =
        images.length === 1 ? 'max-w-64 grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'

    return (
        <Card>
            <CardContent className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                    <WeiboAvatar
                        name={post.author.name.length > 0 ? post.author.name : '未'}
                        avatarUrl={post.author.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="truncate font-medium">
                                {post.author.name.length > 0 ? post.author.name : '未知作者'}
                            </span>
                            {post.author.isVerified ? (
                                <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" />
                            ) : null}
                            <span className="shrink-0 text-muted-foreground text-xs">{formatPostTime(post)}</span>
                            {post.source.length > 0 ? (
                                <span className="shrink-0 text-muted-foreground text-xs">来自 {post.source}</span>
                            ) : null}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">
                            <WeiboRichText segments={bodySegments} />
                        </p>
                        {post.isLongText && fullText === null ? (
                            <Button
                                size="xs"
                                variant="ghost"
                                className="mt-1 h-auto px-0 text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
                                isLoading={isExpanding}
                                onClick={handleExpand}
                            >
                                展开全文
                            </Button>
                        ) : null}
                    </div>
                </div>

                {images.length > 0 ? (
                    <div className={cn('grid w-full gap-1', gridClassName)}>
                        {images.map((originUrl, index) => {
                            const thumbUrl = thumbnails[index] ?? originUrl
                            return (
                                <button
                                    key={originUrl}
                                    type="button"
                                    onClick={() => {
                                        setPreview({
                                            origin: originUrl,
                                            thumb: thumbUrl,
                                            size: post.media.sizes[index] ?? null,
                                        })
                                    }}
                                    aria-label="查看原图"
                                    className={cn(
                                        'overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5',
                                        images.length === 1 ? 'aspect-video' : 'aspect-square',
                                    )}
                                >
                                    <WeiboImage
                                        remoteUrl={thumbUrl}
                                        alt="微博配图"
                                        className="size-full object-cover"
                                    />
                                </button>
                            )
                        })}
                    </div>
                ) : null}

                {images.length === 0 && post.media.imageCount > 0 ? (
                    <p className="text-muted-foreground text-xs">
                        本条含 {post.media.imageCount} 张配图，直链未能解析，请打开原文查看。
                    </p>
                ) : null}

                {post.retweeted !== null ? (
                    <blockquote className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs ring-1 ring-foreground/5">
                        <p className="font-medium">
                            @{post.retweeted.authorName.length > 0 ? post.retweeted.authorName : '原作者'}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap wrap-break-word">
                            {post.retweeted.text.length > 0 ? post.retweeted.text : '（原微博不可见）'}
                        </p>
                    </blockquote>
                ) : null}

                <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
                    <Metric icon={<Repeat2 className="size-3.5" />} label="转发" value={post.metrics.reposts} />
                    <button
                        type="button"
                        onClick={toggleComments}
                        aria-expanded={isCommentsOpen}
                        className={cn(
                            'flex items-center gap-1 transition-colors hover:text-foreground',
                            isCommentsOpen && 'text-primary',
                        )}
                    >
                        <MessageCircle className="size-3.5" aria-hidden="true" />
                        {post.metrics.comments}
                    </button>
                    <LikeButton postId={post.id} initialLiked={post.isLiked} initialCount={post.metrics.likes} />
                    {post.media.imageCount > 0 ? (
                        <Metric icon={<ImageIcon className="size-3.5" />} label="图片" value={post.media.imageCount} />
                    ) : null}
                    {post.media.videoUrl === null ? null : (
                        <span className="flex items-center gap-1">
                            <Video className="size-3.5" aria-hidden="true" />
                            含视频
                        </span>
                    )}
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={handleOpen}>
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        原文
                    </Button>
                </div>

                {isCommentsOpen ? <WeiboCommentList postId={post.id} totalCount={post.metrics.comments} /> : null}
            </CardContent>
            {preview === null ? null : (
                <WeiboLightbox
                    originUrl={preview.origin}
                    thumbUrl={preview.thumb}
                    originalSize={preview.size}
                    onClose={handlePreviewClose}
                />
            )}
        </Card>
    )
}

interface MetricProps {
    icon: JSX.Element
    label: string
    value: number
}

/** 互动数：图标只作装饰，可读名由 aria-label 给出，避免读屏念出图标名 */
function Metric({ icon, label, value }: MetricProps): JSX.Element {
    return (
        <span className="flex items-center gap-1" aria-label={`${label} ${String(value)}`}>
            <span aria-hidden>{icon}</span>
            {value}
        </span>
    )
}
