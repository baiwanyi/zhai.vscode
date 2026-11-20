/**
 * 时间线卡片：按标准 Card 分区——CardHeader 放作者头像、博主与时间来源（CardTitle / CardDescription），
 * CardContent 放正文（含表情）、图文混排媒体区、转发块与按需展开的评论区，CardFooter 只放互动数据；
 * 原文与两个卡片动作收在 CardAction 的「更多」菜单里，卡片底部不再堆一排按钮。
 * 复用约定：数据是归一化后的 WeiboTimelinePost，图片地址已在宿主按白名单收窄；
 * 头像与富文本分别交给 WeiboAvatar / WeiboRichText，配图、视频封面与灯箱在本文件内，
 * 主贴与转发体的媒体共用 PostMediaGrid，避免两套九宫格各写一份；
 * 所有图片都经 useWeiboImage 换成本地地址——图床按 Referer 放行，Webview 直连会被拒。
 * 关键约束：hooks 只能在组件内调用，故表情、配图、点赞各自抽成子组件，不能在 map 里直接调；
 * 图片按「进入视口附近」才发起下载；视频统一交给 layout/WeiboVideoPlayer（自绘控件栏、空格控制），
 * 地址经宿主回环中转补 Referer，不落缓存；拿不到整段地址时才回退打开原文（转发区回退被转发原文）；
 * 评论区按需展开，未展开不请求；
 * 长文默认展开：主贴正文与转发体各自进入视口即自动取全文替换摘要（转发体只有数字 id，接口同样支持），
 * 只在失败或尚未进入视口时保留手动入口；每处各自限一条在飞，避免连点或重复挂载把同一篇抽两次；
 * 已取到的转发全文还会随「保存到笔记」「添加到 AI 对话」一起交给宿主，省掉一次重复请求；
 * 「保存到笔记」「添加到 AI 对话」只把卡片展示字段交给宿主，落盘与会话归属都在宿主侧决定，
 * 前端不做任何路径拼接，两个动作互斥以防并发写盘或并发改上下文。
 */
import { cn } from 'cn'
import { format } from 'date-fns'
import {
    BadgeCheck,
    Check,
    ExternalLink,
    Heart,
    ImageIcon,
    ImageOff,
    MessageCircle,
    MessageSquareQuote,
    MoreHorizontal,
    Play,
    Repeat2,
    Save,
    Video,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Spinner } from '@components/ui/spinner'
import type {
    WeiboLikeResult,
    WeiboLongTextResult,
    WeiboTimelineImageSize,
    WeiboTimelineMedia,
    WeiboTimelinePost,
    WeiboTimelineSegment,
    WeiboTimelineVideoResolution,
    WeiboVideoResult,
} from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboCommentList } from './WeiboCommentList'
import { WeiboLightbox } from './WeiboLightbox'
import { WeiboRichText } from './WeiboRichText'
import { WeiboVideoPlayer } from './WeiboVideoPlayer'
import type { JSX } from 'react'
import { useHasEnteredViewport } from '../hooks/useHasEnteredViewport'
import { useWeiboImage } from '../hooks/useWeiboImage'
import { useWeiboPostActions } from '../hooks/useWeiboPostActions'

/** 发布时间：同一年省掉年份，解析失败回退上游原串；主贴与转发体共用 */
function formatTime(createdAt: string, createdAtRaw: string): string {
    if (createdAt.length === 0) {
        return createdAtRaw
    }
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) {
        return createdAtRaw
    }
    const isSameYear = date.getFullYear() === new Date().getFullYear()
    return format(date, isSameYear ? 'MM-dd HH:mm' : 'yyyy-MM-dd HH:mm')
}

/** 主贴发布时间 */
function formatPostTime(post: WeiboTimelinePost): string {
    return formatTime(post.createdAt, post.createdAtRaw)
}

/** 视频时长：不足一小时给 m:ss，超过给 h:mm:ss */
function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.trunc(seconds))
    const minutes = Math.floor(total / 60)
    const rest = total % 60
    if (minutes < 60) {
        return `${String(minutes)}:${String(rest).padStart(2, '0')}`
    }
    return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
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

/** 原图预览状态：列表用中图，点击后才在原图浮层里取原图 */
interface PreviewState {
    origin: string
    thumb: string
    size: WeiboTimelineImageSize | null
}

interface PostMediaGridProps {
    media: WeiboTimelineMedia
    /** 点击视频封面：观看一律回原文 */
    onOpenPost: () => void
    /** 点击图片：打开灯箱 */
    onPreview: (preview: PreviewState) => void
}

interface InlineVideoPlayerProps {
    playUrl: string | null
    /** 封面远程地址：经图片代理换成 data URI 后作 poster */
    posterUrl: string | null
    /** 视频最大分辨率：播放器左上角清晰度角标 */
    resolution: WeiboTimelineVideoResolution | null
    onOpenPost: () => void
}

/**
 * 纯视频微博的播放器外壳：先把 CDN 地址换成宿主回环中转地址，再交给 WeiboVideoPlayer 铺开，
 * poster 由播放器自己把封面图换成本地地址；地址换不到时退回「在浏览器打开原文」。
 */
function InlineVideoPlayer({ playUrl, posterUrl, resolution, onOpenPost }: InlineVideoPlayerProps): JSX.Element {
    const [state, setState] = useState<{ localUrl: string | null; isFailed: boolean }>({
        localUrl: null,
        isFailed: false,
    })

    useEffect(() => {
        if (playUrl === null) {
            return
        }
        let isCancelled = false
        request<WeiboVideoResult>('weibo/video', { url: playUrl }, 20_000)
            .then((result) => {
                if (isCancelled) {
                    return
                }
                setState({ localUrl: result.url, isFailed: result.url === null })
            })
            .catch((cause: unknown) => {
                if (isCancelled) {
                    return
                }
                setState({ localUrl: null, isFailed: true })
                toastError(cause)
            })
        return (): void => {
            isCancelled = true
        }
    }, [playUrl])

    // 没有整段地址或换地址失败：直接给原文入口，不铺一个点不动的播放器
    if (playUrl === null || state.isFailed) {
        return (
            <button
                type="button"
                onClick={onOpenPost}
                className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted px-3 text-center text-muted-foreground text-xs"
            >
                视频暂不可播放，点击在浏览器打开原文
            </button>
        )
    }
    return <WeiboVideoPlayer src={state.localUrl} posterUrl={posterUrl} resolution={resolution} />
}

/**
 * 媒体区：有视频时按混排原序渲染，纯图片走九宫格。
 * 主贴与转发体共用这一份——转发里的图片与视频同样要能看，不能只显示文字摘要。
 * 关键约束：配图全量展示，不按 9 张截断（上游给多少张就排多少格，懒加载负责按需取图）；
 * 视频点击后在原格子里换成 <video> 播放；CDN 校验 Referer 而 Webview 改不了请求头，
 * 故 src 用宿主回环中转地址（流式转发，不落缓存）；拿不到地址时回退「打开原文」，避免点了没反应。
 */
function PostMediaGrid({ media, onOpenPost, onPreview }: PostMediaGridProps): JSX.Element | null {
    const images = media.images
    const thumbnails = media.thumbnails
    const mixedItems = media.videoCount > 0 ? media.items : []
    const gridClassName =
        images.length === 1 ? 'max-w-64 grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
    /** 播放状态：remoteUrl 是上游地址，localUrl 是宿主回环中转地址；同一媒体区只播一个视频 */
    const [player, setPlayer] = useState<{ remoteUrl: string; localUrl: string | null; isFailed: boolean } | null>(null)

    const handlePlay = useCallback(
        (playUrl: string | null): void => {
            if (playUrl === null) {
                onOpenPost()
                return
            }
            setPlayer({ remoteUrl: playUrl, localUrl: null, isFailed: false })
            void request<WeiboVideoResult>('weibo/video', { url: playUrl }, 20_000)
                .then((result) => {
                    setPlayer((previous) =>
                        previous === null || previous.remoteUrl !== playUrl
                            ? previous
                            : { ...previous, localUrl: result.url, isFailed: result.url === null },
                    )
                })
                .catch((cause: unknown) => {
                    setPlayer((previous) =>
                        previous === null || previous.remoteUrl !== playUrl
                            ? previous
                            : { ...previous, isFailed: true },
                    )
                    toastError(cause)
                })
        },
        [onOpenPost],
    )

    /** 纯视频（没有配图）：直接铺播放器，先显示 poster，点播放才取流 */
    const onlyVideo = mixedItems.length === 1 ? mixedItems[0] : undefined
    if (onlyVideo !== undefined && onlyVideo.kind === 'video' && media.imageCount === 0) {
        return (
            <InlineVideoPlayer
                playUrl={onlyVideo.playUrl}
                posterUrl={onlyVideo.coverMiddleUrl ?? onlyVideo.coverUrl}
                resolution={onlyVideo.resolution}
                onOpenPost={onOpenPost}
            />
        )
    }

    if (mixedItems.length > 0) {
        return (
            <>
                <div className="grid w-full grid-cols-3 gap-1">
                    {mixedItems.map((item, index) => {
                        if (item.kind === 'image') {
                            return (
                                <button
                                    key={`image-${item.url}`}
                                    type="button"
                                    onClick={() => {
                                        onPreview({ origin: item.url, thumb: item.middleUrl, size: item.size })
                                    }}
                                    aria-label="查看原图"
                                    className="aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5"
                                >
                                    <WeiboImage
                                        remoteUrl={item.middleUrl}
                                        alt="微博配图"
                                        className="size-full object-cover"
                                    />
                                </button>
                            )
                        }
                        // 视频：点击后在原位换成播放器；地址要先经宿主换成本地中转地址
                        if (player !== null && player.remoteUrl === item.playUrl) {
                            return (
                                <div
                                    key={`video-${String(index)}`}
                                    className="col-span-3 aspect-video w-full overflow-hidden rounded-lg bg-black"
                                >
                                    {player.localUrl === null ? (
                                        <button
                                            type="button"
                                            onClick={onOpenPost}
                                            className="flex size-full items-center justify-center px-3 text-center text-muted-foreground text-xs"
                                        >
                                            {player.isFailed ? '视频加载失败，点击在浏览器打开原文' : '正在加载视频…'}
                                        </button>
                                    ) : (
                                        <WeiboVideoPlayer
                                            src={player.localUrl}
                                            posterUrl={item.coverMiddleUrl ?? item.coverUrl}
                                            resolution={item.resolution}
                                            autoPlay
                                            className="size-full"
                                        />
                                    )}
                                </div>
                            )
                        }
                        return (
                            <button
                                key={`video-${String(index)}`}
                                type="button"
                                onClick={() => {
                                    handlePlay(item.playUrl)
                                }}
                                aria-label="播放视频"
                                className="relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5"
                            >
                                {item.coverMiddleUrl === null ? (
                                    <span className="flex size-full items-center justify-center text-muted-foreground">
                                        <Video className="size-5" aria-hidden="true" />
                                    </span>
                                ) : (
                                    <>
                                        <WeiboImage
                                            remoteUrl={item.coverMiddleUrl}
                                            alt="视频封面"
                                            className="size-full object-cover"
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                                            <Play className="size-6" aria-hidden="true" fill="currentColor" />
                                        </span>
                                    </>
                                )}
                                {item.durationSeconds === null ? null : (
                                    <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[0.6rem] leading-tight text-white">
                                        {formatDuration(item.durationSeconds)}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </>
        )
    }

    if (images.length === 0) {
        return null
    }
    return (
        <>
            <div className={cn('grid w-full gap-1', gridClassName)}>
                {images.map((originUrl, index) => {
                    const thumbUrl = thumbnails[index] ?? originUrl
                    return (
                        <button
                            key={originUrl}
                            type="button"
                            onClick={() => {
                                onPreview({ origin: originUrl, thumb: thumbUrl, size: media.sizes[index] ?? null })
                            }}
                            aria-label="查看原图"
                            className={cn(
                                'overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5',
                                images.length === 1 ? 'aspect-video' : 'aspect-square',
                            )}
                        >
                            <WeiboImage remoteUrl={thumbUrl} alt="微博配图" className="size-full object-cover" />
                        </button>
                    )
                })}
            </div>
        </>
    )
}

interface LongTextStatusProps {
    /** 全文请求进行中：只给文字提示，不铺按钮 */
    isLoading: boolean
    /** 上一轮取全文失败：按钮文案换成重试 */
    hasFailed: boolean
    onRetry: () => void
}

/** 长文展开态：主贴与转发体共用同一套外观，加载中给文字，失败或未进视口时给可点按钮 */
function LongTextStatus({ isLoading, hasFailed, onRetry }: LongTextStatusProps): JSX.Element {
    if (isLoading) {
        return <Spinner />
    }
    return (
        <Button variant="ghost" onClick={onRetry}>
            {hasFailed ? '重新加载全文' : '展开全文'}
        </Button>
    )
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

    /** 引用微博的视频封面：打开被转发的原文，而不是当前这条转发 */
    const handleOpenRetweeted = useCallback((): void => {
        if (post.retweeted === null) {
            return
        }
        void request('weibo/openPost', { url: post.retweeted.url }).catch(toastError)
    }, [post.retweeted])

    /** 原图预览：点击九宫格时才取原图，列表始终用中等尺寸；尺寸随预览一起带上 */
    const [preview, setPreview] = useState<PreviewState | null>(null)
    const [isCommentsOpen, setIsCommentsOpen] = useState(false)
    /** 长文全文：取到后替换摘要，卡片保持展开态直到列表重建 */
    const [fullText, setFullText] = useState<string | null>(null)
    const [isExpanding, setIsExpanding] = useState(false)
    /** 全文取失败：保留摘要并放出可点的「展开全文」，不再自动重试避免刷接口 */
    const [hasExpandFailed, setHasExpandFailed] = useState(false)
    /** 长文请求占位：ref 判定，避开闭包读到旧 state 与严格模式下的双次 effect */
    const isExpandingRef = useRef(false)
    /** 正文进入视口才取全文：一屏几十条长文同时打接口会被上游限流 */
    const { ref: bodyRef, hasEntered: isBodyVisible } = useHasEnteredViewport<HTMLParagraphElement>()
    /** 转发体全文：与主贴各自独立，引用块进入视口才取，不拖累主贴的展开节奏 */
    const [retweetedFullText, setRetweetedFullText] = useState<string | null>(null)
    const [isRetweetedExpanding, setIsRetweetedExpanding] = useState(false)
    const [hasRetweetedExpandFailed, setHasRetweetedExpandFailed] = useState(false)
    const isRetweetedExpandingRef = useRef(false)
    const { ref: retweetedBodyRef, hasEntered: isRetweetedVisible } = useHasEnteredViewport<HTMLQuoteElement>()

    const handlePreviewClose = useCallback((): void => {
        setPreview(null)
    }, [])

    const toggleComments = useCallback((): void => {
        setIsCommentsOpen((previous) => !previous)
    }, [])

    /**
     * 取长文全文：mblogid 优先（长文接口按它取），缺失才用数字 id。
     * 关键约束：自动展开属于后台补全，失败只落重试入口不弹提示，免得静默失败连弹多条 toast；
     * 只有用户主动点按钮时才提示错误。
     */
    const requestFullText = useCallback(
        (isManual = false): void => {
            if (isExpandingRef.current) {
                return
            }
            isExpandingRef.current = true
            setIsExpanding(true)
            const targetId = post.mblogid.length > 0 ? post.mblogid : post.id
            void request<WeiboLongTextResult>('weibo/longtext', { id: targetId }, 20_000)
                .then((result) => {
                    setFullText(result.text)
                })
                .catch((cause: unknown) => {
                    setHasExpandFailed(true)
                    if (isManual) {
                        toastError(cause)
                    }
                })
                .finally(() => {
                    isExpandingRef.current = false
                    setIsExpanding(false)
                })
        },
        [post.id, post.mblogid],
    )

    /** 默认显示全文：长文正文一进视口就自动取，不再等用户点「展开全文」 */
    useEffect(() => {
        if (!post.isLongText || fullText !== null || hasExpandFailed || !isBodyVisible) {
            return
        }
        requestFullText()
    }, [fullText, hasExpandFailed, isBodyVisible, post.isLongText, requestFullText])

    /**
     * 取转发体全文：转发体没有 mblogid，一律用它自己的数字 id（长文接口同样支持）。
     * 失败处置与主贴一致——自动展开不提示，只留重试入口。
     */
    const requestRetweetedFullText = useCallback(
        (isManual = false): void => {
            const retweeted = post.retweeted
            if (retweeted === null || isRetweetedExpandingRef.current) {
                return
            }
            isRetweetedExpandingRef.current = true
            setIsRetweetedExpanding(true)
            void request<WeiboLongTextResult>('weibo/longtext', { id: retweeted.id }, 20_000)
                .then((result) => {
                    setRetweetedFullText(result.text)
                })
                .catch((cause: unknown) => {
                    setHasRetweetedExpandFailed(true)
                    if (isManual) {
                        toastError(cause)
                    }
                })
                .finally(() => {
                    isRetweetedExpandingRef.current = false
                    setIsRetweetedExpanding(false)
                })
        },
        [post.retweeted],
    )

    /** 转发体同样是长文时，引用块进入视口即自动展开，与主贴互不影响 */
    useEffect(() => {
        const retweeted = post.retweeted
        if (retweeted === null || !retweeted.isLongText) {
            return
        }
        if (retweetedFullText !== null || hasRetweetedExpandFailed || !isRetweetedVisible) {
            return
        }
        requestRetweetedFullText()
    }, [hasRetweetedExpandFailed, isRetweetedVisible, post.retweeted, requestRetweetedFullText, retweetedFullText])

    /** 卡片动作：保存到笔记与添加到 AI 对话，主贴与转发已展开的全文都一并带出 */
    const postActions = useWeiboPostActions(post, fullText, retweetedFullText)

    /** 正文分段：展开全文后整段替换为接口返回的纯文本 */
    const bodySegments: WeiboTimelineSegment[] = fullText === null ? post.segments : [{ type: 'text', text: fullText }]

    /** 转发体：取到全文用全文，否则用归一化后的摘要 */
    const retweeted = post.retweeted
    const retweetedText = retweeted === null ? '' : (retweetedFullText ?? retweeted.text)

    /** 直链一张都没解析出来但上游声明有图：单独给提示，媒体区自身不再重复 */
    const isImageMissing = post.media.images.length === 0 && post.media.imageCount > 0

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start gap-3">
                    <WeiboAvatar
                        name={post.author.name.length > 0 ? post.author.name : '未'}
                        avatarUrl={post.author.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                        <CardTitle className="flex flex-wrap items-center gap-1 text-sm">
                            <span className="truncate">
                                {post.author.name.length > 0 ? post.author.name : '未知作者'}
                            </span>
                            {post.author.isVerified ? (
                                <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" />
                            ) : null}
                            {post.author.id.length > 0 ? (
                                <span className="ml-1 shrink-0 text-muted-foreground">@{post.author.id}</span>
                            ) : null}
                        </CardTitle>
                        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="shrink-0">{formatPostTime(post)}</span>
                            {post.source.length > 0 ? <span className="shrink-0">来自 {post.source}</span> : null}
                        </CardDescription>
                    </div>
                </div>
                {/* 原文与两个卡片动作收进「更多」菜单：底部只留互动数据，卡片头部不再堆按钮 */}
                <CardAction>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" tooltip="更多操作" aria-label="更多操作">
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={handleOpen}>
                                    <ExternalLink />
                                    在浏览器打开原文
                                </DropdownMenuItem>
                                {/* 两个动作互斥：任一请求进行中两者都禁用，避免并发写盘与并发改上下文 */}
                                <DropdownMenuItem
                                    disabled={postActions.isAddingToChat}
                                    onSelect={postActions.saveToNote}
                                >
                                    {postActions.isSavedNote ? <Check /> : <Save />}
                                    {postActions.isSavedNote
                                        ? '已保存到笔记'
                                        : postActions.isSavingNote
                                          ? '正在保存…'
                                          : '保存到笔记'}
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={postActions.isSavingNote} onSelect={postActions.addToChat}>
                                    <MessageSquareQuote />
                                    {postActions.isAddingToChat ? '正在添加到对话…' : '添加到 AI 对话'}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <p ref={bodyRef} className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">
                    <WeiboRichText segments={bodySegments} />
                </p>
                {post.isLongText && fullText === null ? (
                    <LongTextStatus
                        isLoading={isExpanding}
                        hasFailed={hasExpandFailed}
                        onRetry={() => {
                            requestFullText(true)
                        }}
                    />
                ) : null}

                <PostMediaGrid media={post.media} onOpenPost={handleOpen} onPreview={setPreview} />

                {isImageMissing ? (
                    <p className="text-muted-foreground text-xs">
                        本条含 {post.media.imageCount} 张配图，直链未能解析，请打开原文查看。
                    </p>
                ) : null}

                {retweeted !== null ? (
                    <blockquote
                        ref={retweetedBodyRef}
                        className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground ring-1 ring-foreground/5"
                    >
                        {/* 作者行与主贴同构：作者名 + 认证角标 + @UID，下一行单独放发布时间 */}
                        <div className="flex flex-wrap items-center gap-1">
                            <span className="font-medium text-foreground">
                                {retweeted.authorName.length > 0 ? retweeted.authorName : '原作者'}
                            </span>
                            {retweeted.authorIsVerified ? (
                                <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" />
                            ) : null}
                            {retweeted.authorId.length > 0 ? (
                                <>
                                    <span className="ml-1 shrink-0 text-muted-foreground">@{retweeted.authorId}</span>
                                    <span className="shrink-0 text-muted-foreground">·</span>
                                </>
                            ) : null}
                            <span className="shrink-0 text-muted-foreground">
                                {formatTime(retweeted.createdAt, retweeted.createdAtRaw)}
                            </span>
                        </div>

                        <p className="whitespace-pre-wrap wrap-break-word">
                            {retweetedText.length > 0 ? retweetedText : '（原微博不可见）'}
                        </p>
                        {retweeted.isLongText && retweetedFullText === null ? (
                            <LongTextStatus
                                isLoading={isRetweetedExpanding}
                                hasFailed={hasRetweetedExpandFailed}
                                onRetry={() => {
                                    requestRetweetedFullText(true)
                                }}
                            />
                        ) : null}

                        {/* 引用微博的图片与视频同样要展示：媒体结构与主贴一致，图片开灯箱，视频回被转发的原文 */}
                        <PostMediaGrid
                            media={retweeted.media}
                            onOpenPost={handleOpenRetweeted}
                            onPreview={setPreview}
                        />
                    </blockquote>
                ) : null}

                {isCommentsOpen ? <WeiboCommentList postId={post.id} totalCount={post.metrics.comments} /> : null}
            </CardContent>

            <CardFooter className="border-0 bg-transparent text-muted-foreground">
                <div className="flex flex-1 items-center">
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
                </div>

                {post.media.imageCount > 0 ? (
                    <Metric icon={<ImageIcon className="size-3.5" />} label="图片" value={post.media.imageCount} />
                ) : null}
                {post.media.videoCount > 0 ? (
                    <Metric icon={<Video className="size-3.5" />} label="视频" value={post.media.videoCount} />
                ) : post.media.videoUrl === null ? null : (
                    <span className="flex items-center gap-1">
                        <Video className="size-3.5" aria-hidden="true" />
                        含视频
                    </span>
                )}
            </CardFooter>
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
