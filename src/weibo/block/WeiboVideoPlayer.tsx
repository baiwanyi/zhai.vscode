/**
 * 微博视频播放器：自绘控件栏，避免原生 controls 在 Webview 里样式与自动隐藏都不可控。
 * 复用约定：主贴与转发体共用；src 是宿主回环中转地址（见 14.4），poster 是封面图 data URI；
 * 按钮取 @webview/components/Button，进度条取 @components/ui/slider，清晰度角标取 @components/ui/badge。
 * 关键约束：容器默认 16:9，传入 aspectRatio（视频分辨率算出的宽高比）时按该比例铺开，竖屏不再留黑边；
 * 高度一律限到 720px，竖屏比例超过这条线时由 video 的 object-contain 居中、左右留黑底，不撑长卡片；
 * 控件栏只在播放中显示，鼠标静止 2.5s 后淡出；暂停 / 未播放时整条控件栏不出现，
 * 只留中央播放键，避免挡住画面；空格切换播放/暂停（容器可聚焦）；
 * 进度条能否拖动由宿主下发（转码输出不支持 Range，此时只显示进度不响应拖动）；
 * 中央播放键只在暂停时出现，播放时不挡画面；全屏在 Webview 里可能被拒，失败静默忽略；
 * 播放器叠在视频上固定是暗底，文字与控件必须写死白色——语义色在暗色主题下会翻成浅底看不清，
 * 因此这里只覆盖按钮/滑块的配色，不改组件本体。
 */
import { cn } from 'cn'
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Slider } from '@components/ui/slider'
import type { WeiboTimelineVideoResolution } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import type { JSX, KeyboardEvent } from 'react'
import { useWeiboImage } from '../hooks/useWeiboImage'
import { resolveVideoDisplayDuration } from '../utils/weiboTime'

/** 控件栏自动隐藏延迟：与常见播放器一致，鼠标静止 2.5 秒后淡出 */
const CONTROLS_HIDE_DELAY_MS = 2500

/** 视频叠层上的控件配色：固定白色，悬停时压一层半透明白底 */
const OVERLAY_BUTTON_CLASS = 'text-white/90 hover:bg-white/20 hover:text-white'

/** 进度条配色：暗底上改用白色轨道，避免默认的 muted / primary 让刻度在视频上看不清 */
const OVERLAY_SLIDER_CLASS =
    'min-w-0 flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:bg-white/30'

/**
 * 清晰度角标：按短边归类——竖屏 720×1280 与横屏 1280×720 都算 720P。
 * 2K / 4K / 8K 按业界惯例对应短边 1440 / 2160 / 4320。
 */
function formatResolutionLabel(resolution: WeiboTimelineVideoResolution): string {
    const shortSide = Math.min(resolution.width, resolution.height)
    if (shortSide >= 4320) {
        return '8K'
    }
    if (shortSide >= 2160) {
        return '4K'
    }
    if (shortSide >= 1440) {
        return '2K'
    }
    if (shortSide >= 1080) {
        return '1080P'
    }
    if (shortSide >= 720) {
        return '720P'
    }
    if (shortSide >= 480) {
        return '480P'
    }
    return '320P'
}

/** 播放时间格式：不足一小时显示 mm:ss，超过则 h:mm:ss */
function formatClock(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00'
    }
    const total = Math.floor(seconds)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const rest = total % 60
    if (hours > 0) {
        return `${String(hours)}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    }
    return `${String(minutes)}:${String(rest).padStart(2, '0')}`
}

interface WeiboVideoPlayerProps {
    /** 可播放地址：宿主回环中转地址，缺失时只铺封面 */
    src: string | null
    /** 封面远程地址：组件内换成 data URI 再作 poster，图床直连会被 Webview 拒绝 */
    posterUrl: string | null
    /** 视频最大分辨率：左上角清晰度角标，缺失时不显示 */
    resolution: WeiboTimelineVideoResolution | null
    /** 进来就自动播：默认关闭，播放一律由用户点中央按钮或空格触发 */
    autoPlay?: boolean
    /**
     * 容器宽高比（宽 / 高）：传视频分辨率算出的比例，竖屏视频就按竖框铺开，
     * 不再塞进 16:9 的框里、左右留一大片黑边；缺失时回落到 16:9。
     */
    aspectRatio?: number | null
    /**
     * 进度条是否可拖动：宿主转码时输出分片 mp4、不支持 Range，拖动只会从头重播，
     * 因此此时禁用拖动只显示进度，避免「拖了没反应」。
     */
    canSeek?: boolean
    /**
     * 上游声明的时长（秒）：分片 mp4 的 metadata 里 duration 可能偏小甚至为 Infinity，
     * 此时用上游值兜底，避免出现「总时长比已播放秒数还短」。
     */
    declaredDuration?: number | null
    /** 额外类名：九宫格里需要 col-span-3 撑满一行 */
    className?: string
}

export function WeiboVideoPlayer({
    src,
    posterUrl,
    resolution,
    autoPlay = false,
    aspectRatio = null,
    canSeek = true,
    declaredDuration = null,
    className,
}: WeiboVideoPlayerProps): JSX.Element {
    const poster = useWeiboImage(posterUrl ?? '')
    const containerRef = useRef<HTMLDivElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const hideTimerRef = useRef<number | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    /** 播放中的控件栏是否被鼠标唤醒：暂停 / 未播放时控件栏一律不显示，只留中央播放键 */
    const [isControlsRevealed, setIsControlsRevealed] = useState(true)
    const isControlsVisible = isPlaying && isControlsRevealed
    /** 有效比例：非有限值或非正数一律视为缺失，容器留在 16:9 */
    const resolvedRatio = aspectRatio !== null && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null

    /**
     * 显示用总时长：metadata 时长不可信（分片 mp4 常为 Infinity 或偏小）时由上游声明值兜底，
     * 并始终不小于当前播放位置，避免出现「总时长小于已播放秒数」。
     */
    const displayDuration = resolveVideoDisplayDuration(duration, declaredDuration, currentTime)

    const clearHideTimer = useCallback((): void => {
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current)
            hideTimerRef.current = null
        }
    }, [])

    /** 只有播放中才安排隐藏：暂停时控件必须常显，否则用户找不到播放键 */
    const scheduleHide = useCallback((): void => {
        clearHideTimer()
        hideTimerRef.current = window.setTimeout(() => {
            setIsControlsRevealed(false)
        }, CONTROLS_HIDE_DELAY_MS)
    }, [clearHideTimer])

    useEffect(() => {
        if (!isPlaying) {
            clearHideTimer()
            return clearHideTimer
        }
        scheduleHide()
        return clearHideTimer
    }, [isPlaying, scheduleHide, clearHideTimer])

    const togglePlay = useCallback((): void => {
        const video = videoRef.current
        if (video === null) {
            return
        }
        if (video.paused) {
            // 自动播放被策略拒绝时保持暂停，等用户再点一次；不弹错误打断阅读
            void video.play().catch(() => undefined)
            return
        }
        video.pause()
    }, [])

    const toggleMute = useCallback((): void => {
        const video = videoRef.current
        if (video === null) {
            return
        }
        video.muted = !video.muted
        setIsMuted(video.muted)
    }, [])

    const toggleFullscreen = useCallback((): void => {
        const container = containerRef.current
        if (container === null) {
            return
        }
        if (document.fullscreenElement !== null) {
            void document.exitFullscreen().catch(() => undefined)
            return
        }
        void container.requestFullscreen().catch(() => undefined)
    }, [])

    /**
     * 空格切换播放/暂停：preventDefault 同时挡掉页面滚动与 video 原生空格行为。
     * 关键约束：只处理容器自身聚焦时的空格——焦点在内部按钮上时，空格已经由按钮自己触发一次，
     * 再冒泡到这里会立刻反向切回去，表现为「按空格没反应」。
     */
    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>): void => {
            if (event.target !== event.currentTarget || event.key !== ' ') {
                return
            }
            event.preventDefault()
            togglePlay()
        },
        [togglePlay],
    )

    return (
        <div
            ref={containerRef}
            role="group"
            aria-label="视频播放器"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => {
                setIsControlsRevealed(true)
            }}
            onMouseMove={() => {
                if (!isPlaying) {
                    return
                }
                setIsControlsRevealed(true)
                scheduleHide()
            }}
            onMouseLeave={() => {
                if (!isPlaying) {
                    return
                }
                clearHideTimer()
                setIsControlsRevealed(false)
            }}
            className={cn(
                // 限高 720px：竖屏视频按比例铺开会很占版面，超过就由 object-contain 居中留黑边
                'group relative aspect-video max-h-[720px] w-full overflow-hidden rounded-lg bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className,
            )}
            style={resolvedRatio === null ? undefined : { aspectRatio: String(resolvedRatio) }}
        >
            <video
                ref={videoRef}
                src={src ?? undefined}
                poster={poster.localUrl ?? undefined}
                preload="none"
                playsInline
                autoPlay={autoPlay}
                className="size-full object-contain"
                onPlay={() => {
                    setIsPlaying(true)
                    // 重新起播时先把控件栏亮出来，再按「静止 2.5s」的节奏收起
                    setIsControlsRevealed(true)
                }}
                onPause={() => {
                    setIsPlaying(false)
                }}
                onEnded={() => {
                    setIsPlaying(false)
                    setIsControlsRevealed(true)
                    // 播完回到片头：否则再点播放会从末尾起播、立刻又 ended，看起来像按钮失灵
                    const video = videoRef.current
                    if (video !== null) {
                        video.currentTime = 0
                    }
                    setCurrentTime(0)
                }}
                onTimeUpdate={(event) => {
                    setCurrentTime(event.currentTarget.currentTime)
                }}
                onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration)
                }}
                onVolumeChange={(event) => {
                    setIsMuted(event.currentTarget.muted)
                }}
            />

            {/* 全画面点击层：本身不可见，只把点击转成播放/暂停；不碰 video 的原生事件 */}
            <button
                type="button"
                onClick={() => {
                    containerRef.current?.focus()
                    togglePlay()
                }}
                aria-label={isPlaying ? '暂停视频' : '播放视频'}
                className="absolute inset-0 z-10 cursor-pointer bg-transparent"
            />

            {/* 清晰度角标：白色半透明，固定左上角，纯展示不接管点击；播放起来就收起，不压画面 */}
            {resolution === null || isPlaying ? null : (
                <Badge className="pointer-events-none absolute rounded-md bottom-2 right-2 z-20 bg-white/10 font-light text-white/90 backdrop-blur-xs">
                    {formatResolutionLabel(resolution)}
                </Badge>
            )}

            {/* 中央播放键：只在暂停时出现，播放中淡出且不接管点击 */}
            <Button
                variant="ghost"
                size="icon-lg"
                onClick={togglePlay}
                aria-label={isPlaying ? '暂停' : '播放'}
                className={cn(
                    // 用 inset-0 + m-auto 居中，不用 translate：Button 底层的 active:translate-y 会盖掉
                    // -translate-y-1/2，点击时按钮会整体往下跳半个身位
                    'absolute inset-0 z-20 m-auto size-14 rounded-full text-white transition-opacity duration-200 hover:bg-transparent hover:text-white hover:opacity-90 dark:hover:bg-transparent',
                    isPlaying ? 'pointer-events-none opacity-0' : 'opacity-70',
                )}
            >
                <Play className="size-15" fill="currentColor" />
            </Button>

            {/* 底部控件栏：播放中鼠标静止 2.5s 后淡出，鼠标移动立刻回来 */}
            <div
                className={cn(
                    'absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 bg-linear-to-t from-black/80 via-black/40 to-transparent px-3 pt-8 pb-2 transition-opacity duration-200',
                    isControlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
            >
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={togglePlay}
                    aria-label={isPlaying ? '暂停' : '播放'}
                    className={OVERLAY_BUTTON_CLASS}
                >
                    {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                </Button>
                <span className="text-xs text-white/80 tabular-nums font-light">
                    {formatClock(currentTime)} / {formatClock(displayDuration)}
                </span>
                <Slider
                    value={[currentTime]}
                    min={0}
                    max={displayDuration > 0 ? displayDuration : 1}
                    step={0.1}
                    disabled={displayDuration <= 0 || !canSeek}
                    onValueChange={(value) => {
                        const next = value[0]
                        if (next !== undefined) {
                            setCurrentTime(next)
                        }
                    }}
                    onValueCommit={(value) => {
                        const video = videoRef.current
                        const next = value[0]
                        if (video === null || next === undefined) {
                            return
                        }
                        video.currentTime = next
                        setCurrentTime(next)
                    }}
                    aria-label="播放进度"
                    className={OVERLAY_SLIDER_CLASS}
                />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleMute}
                    aria-label={isMuted ? '取消静音' : '静音'}
                    tooltip={isMuted ? '取消静音' : '静音'}
                    className={OVERLAY_BUTTON_CLASS}
                >
                    {isMuted ? <VolumeX /> : <Volume2 />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleFullscreen}
                    aria-label="全屏"
                    tooltip="全屏"
                    className={OVERLAY_BUTTON_CLASS}
                >
                    <Maximize2 />
                </Button>
            </div>
        </div>
    )
}
