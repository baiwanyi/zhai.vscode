/**
 * 媒体区：有视频时按混排原序渲染，纯图片走九宫格；主贴与转发体共用这一份。
 * 复用约定：查看态（展开序号 / 播放地址 / 预览项）由 hooks/useWeiboMediaViewer 持有，
 * 图片经 useWeiboImage 换本地地址，播放器交给 WeiboVideoPlayer，预览交给 WeiboMediaPreview。
 * 关键约束：配图全量展示不按 9 张截断；单图按原比例整张显示、多图才用方格外框裁切；
 * 混排里的视频先占一格（封面 + 播放角标 + 时长），点了才原地换成整行播放器，同一媒体区只播一条；
 * CDN 校验 Referer 而 Webview 改不了请求头，播放器 src 用宿主回环中转地址，拿不到就回退原文。
 */
import { cn } from 'cn'
import { ImageOff, Play, Video, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
    WeiboTimelineMedia,
    WeiboTimelineMediaItem,
    WeiboTimelineVideoResolution,
    WeiboVideoResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { useHasEnteredViewport } from '@webview/hooks/useHasEnteredViewport'
import { useWeiboMediaViewer } from '@webview/weibo/hooks/useWeiboMediaViewer'
import type { WeiboMediaViewerController } from '@webview/weibo/hooks/useWeiboMediaViewer'
import { formatWeiboMediaDuration } from '@webview/weibo/utils/weiboTime'
import { WeiboMediaPreview } from './WeiboMediaPreview'
import { WeiboVideoPlayer } from './WeiboVideoPlayer'
import type { JSX } from 'react'
import { useWeiboImage } from '../hooks/useWeiboImage'

/** 视频取流超时：与宿主侧 20s 口径一致 */
const VIDEO_TIMEOUT_MS = 20_000

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

interface InlineVideoPlayerProps {
    playUrl: string | null
    /** 封面远程地址：经图片代理换成 data URI 后作 poster */
    posterUrl: string | null
    /** 视频最大分辨率：播放器左上角清晰度角标 */
    resolution: WeiboTimelineVideoResolution | null
    /** 上游声明的时长（秒）：分片 mp4 的 metadata 时长可能偏小，播放器据此兜底 */
    declaredDuration: number | null
    onOpenPost: () => void
    /** 从宫格封面点进来时直接起播；纯视频微博保持等用户点中央播放键 */
    autoPlay?: boolean
}

/**
 * 视频播放器外壳：先把 CDN 地址换成宿主回环中转地址，再交给 WeiboVideoPlayer 铺开，
 * poster 由播放器自己把封面图换成本地地址；地址换不到时退回「在浏览器打开原文」。
 */
function InlineVideoPlayer({
    playUrl,
    posterUrl,
    resolution,
    declaredDuration,
    onOpenPost,
    autoPlay = false,
}: InlineVideoPlayerProps): JSX.Element {
    const [state, setState] = useState<{ localUrl: string | null; seekable: boolean; isFailed: boolean }>({
        localUrl: null,
        seekable: false,
        isFailed: false,
    })

    useEffect(() => {
        if (playUrl === null) {
            return
        }
        let isCancelled = false
        request<WeiboVideoResult>(WEIBO_METHODS.video, { url: playUrl }, VIDEO_TIMEOUT_MS)
            .then((result) => {
                if (isCancelled) {
                    return
                }
                setState({ localUrl: result.url, seekable: result.seekable, isFailed: result.url === null })
            })
            .catch((cause: unknown) => {
                if (isCancelled) {
                    return
                }
                setState({ localUrl: null, seekable: false, isFailed: true })
                toastError(cause)
            })
        return (): void => {
            isCancelled = true
        }
    }, [playUrl])

    // 没有整段地址或换地址失败：直接给原文入口，不铺一个点不动的播放器
    if (playUrl === null || state.isFailed) {
        return (
            <Button
                variant="ghost"
                onClick={onOpenPost}
                className="aspect-video h-auto w-full rounded-lg bg-muted px-3 font-normal text-muted-foreground text-xs whitespace-normal hover:bg-muted hover:text-muted-foreground"
            >
                视频暂不可播放，点击在浏览器打开原文
            </Button>
        )
    }
    // 容器按视频分辨率铺开：竖屏视频用竖框，不再塞进 16:9 里留大片黑边
    const aspectRatio = resolution === null || resolution.height <= 0 ? null : resolution.width / resolution.height
    return (
        <WeiboVideoPlayer
            src={state.localUrl}
            posterUrl={posterUrl}
            resolution={resolution}
            autoPlay={autoPlay}
            aspectRatio={aspectRatio}
            canSeek={state.seekable}
            declaredDuration={declaredDuration}
        />
    )
}

interface WeiboMediaImageCellProps {
    middleUrl: string
    onOpen: () => void
}

/** 混排里的图片格：方格外框裁切，点击展开卡片内预览 */
function WeiboMediaImageCell({ middleUrl, onOpen }: WeiboMediaImageCellProps): JSX.Element {
    return (
        <Button
            variant="ghost"
            onClick={onOpen}
            aria-label="展开配图预览"
            className="aspect-square h-auto w-full gap-0 overflow-hidden rounded-lg bg-muted p-0 hover:bg-muted ring-1 ring-foreground/5"
        >
            <WeiboImage remoteUrl={middleUrl} alt="微博配图" className="size-full object-cover" />
        </Button>
    )
}

interface WeiboMediaVideoCellProps {
    item: Extract<WeiboTimelineMediaItem, { kind: 'video' }>
    /** 当前这条正在原地播放 */
    isPlaying: boolean
    onPlay: () => void
    onCollapse: () => void
    onOpenPost: () => void
}

/** 混排里的视频格：在播时原位换成整行播放器，否则只显示封面 + 播放角标 + 时长 */
function WeiboMediaVideoCell({
    item,
    isPlaying,
    onPlay,
    onCollapse,
    onOpenPost,
}: WeiboMediaVideoCellProps): JSX.Element {
    // 时长角标文案：缺失或非有限数时为空串，整块角标不渲染，避免出现空底衬
    const durationLabel = item.durationSeconds === null ? '' : formatWeiboMediaDuration(item.durationSeconds)

    if (isPlaying) {
        return (
            <div className="relative col-span-3">
                <InlineVideoPlayer
                    playUrl={item.playUrl}
                    posterUrl={item.coverMiddleUrl ?? item.coverUrl}
                    resolution={item.resolution}
                    declaredDuration={item.durationSeconds}
                    onOpenPost={onOpenPost}
                    autoPlay
                />
                {/* 收起播放器回到宫格：叠在右上角，配色与播放器控件栏一致（暗底白字） */}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onCollapse}
                    aria-label="收起播放器，返回宫格"
                    tooltip="返回宫格"
                    className="absolute top-2 right-2 z-40 bg-black/50 text-white hover:bg-black/70 hover:text-white"
                >
                    <X className="size-4" />
                </Button>
            </div>
        )
    }

    return (
        <Button
            variant="ghost"
            onClick={onPlay}
            aria-label="播放视频"
            className="relative aspect-square h-auto w-full gap-0 overflow-hidden rounded-lg bg-muted p-0 hover:bg-muted ring-1 ring-foreground/5"
        >
            {item.coverMiddleUrl === null ? (
                <span className="flex size-full items-center justify-center text-muted-foreground">
                    <Video className="size-5" aria-hidden="true" />
                </span>
            ) : (
                <>
                    <WeiboImage remoteUrl={item.coverMiddleUrl} alt="视频封面" className="size-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                        <Play className="size-6" aria-hidden="true" fill="currentColor" />
                    </span>
                </>
            )}
            {durationLabel.length > 0 ? (
                <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[0.6rem] leading-tight text-white">
                    {durationLabel}
                </span>
            ) : null}
        </Button>
    )
}

interface WeiboMixedMediaGridProps {
    items: WeiboTimelineMediaItem[]
    viewer: WeiboMediaViewerController
    onOpenPost: () => void
}

/** 混排宫格：图片与视频按上游原序排三列，视频占一格 */
function WeiboMixedMediaGrid({ items, viewer, onOpenPost }: WeiboMixedMediaGridProps): JSX.Element {
    return (
        <div className="grid w-full grid-cols-3 gap-1">
            {items.map((item, index) => {
                if (item.kind === 'video') {
                    return (
                        <WeiboMediaVideoCell
                            key={`video-${String(index)}`}
                            item={item}
                            isPlaying={viewer.playingUrl !== null && item.playUrl === viewer.playingUrl}
                            onPlay={() => {
                                viewer.playVideo(item.playUrl)
                            }}
                            onCollapse={viewer.collapsePlayer}
                            onOpenPost={onOpenPost}
                        />
                    )
                }
                return (
                    <WeiboMediaImageCell
                        key={`image-${item.url}`}
                        middleUrl={item.middleUrl}
                        onOpen={() => {
                            viewer.openPreview(viewer.previewIndexOfItem.get(index) ?? 0)
                        }}
                    />
                )
            })}
        </div>
    )
}

interface WeiboImageGridProps {
    media: WeiboTimelineMedia
    viewer: WeiboMediaViewerController
}

/** 纯图片宫格：单图按原比例整张显示、不裁剪，多图按方格外框裁切保持整齐 */
function WeiboImageGrid({ media, viewer }: WeiboImageGridProps): JSX.Element {
    const gridClassName =
        media.images.length === 1 ? 'grid-cols-1' : media.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
    const isSingle = media.images.length === 1

    return (
        <div className={cn('grid w-full gap-1', gridClassName)}>
            {media.images.map((originUrl, index) => {
                const size = media.sizes[index] ?? null
                const singleStyle =
                    isSingle && size !== null
                        ? { aspectRatio: `${String(size.width)} / ${String(size.height)}` }
                        : undefined
                return (
                    <Button
                        key={originUrl}
                        variant="ghost"
                        onClick={() => {
                            viewer.openPreview(index)
                        }}
                        aria-label="展开配图预览"
                        style={singleStyle}
                        className={cn(
                            'h-auto w-full gap-0 overflow-hidden rounded-lg bg-muted p-0 hover:bg-muted ring-1 ring-foreground/5',
                            isSingle ? size === null && 'aspect-video' : 'aspect-square',
                        )}
                    >
                        <WeiboImage
                            remoteUrl={media.thumbnails[index] ?? originUrl}
                            alt="微博配图"
                            className={cn('size-full', isSingle ? 'object-contain' : 'object-cover')}
                        />
                    </Button>
                )
            })}
        </div>
    )
}

export interface WeiboPostMediaGridProps {
    media: WeiboTimelineMedia
    /** 视频拿不到整段地址：观看一律回原文 */
    onOpenPost: () => void
}

export function WeiboPostMediaGrid({ media, onOpenPost }: WeiboPostMediaGridProps): JSX.Element | null {
    const viewer = useWeiboMediaViewer(media, onOpenPost)

    if (viewer.expandedIndex !== null) {
        return (
            <WeiboMediaPreview
                items={viewer.previewItems}
                startIndex={viewer.expandedIndex}
                onClose={viewer.closePreview}
            />
        )
    }

    // 纯视频（没有配图）：直接铺播放器，先显示 poster，点播放才取流
    const onlyVideo = viewer.mixedItems.length === 1 ? viewer.mixedItems[0] : undefined
    if (onlyVideo !== undefined && onlyVideo.kind === 'video' && media.imageCount === 0) {
        return (
            <InlineVideoPlayer
                playUrl={onlyVideo.playUrl}
                posterUrl={onlyVideo.coverMiddleUrl ?? onlyVideo.coverUrl}
                resolution={onlyVideo.resolution}
                declaredDuration={onlyVideo.durationSeconds}
                onOpenPost={onOpenPost}
            />
        )
    }

    if (viewer.mixedItems.length > 0) {
        return <WeiboMixedMediaGrid items={viewer.mixedItems} viewer={viewer} onOpenPost={onOpenPost} />
    }

    if (media.images.length === 0) {
        return null
    }
    return <WeiboImageGrid media={media} viewer={viewer} />
}
