/**
 * 媒体查看态：宫格展开的配图序号、原地播放的视频地址，以及两者的派生预览数据。
 * 复用约定：配图预览交给 block/WeiboMediaPreview，本 Hook 只持有状态与折算下标；
 * 打开原文的动作由调用方注入（视频没有整段地址时回退原文）。
 * 关键约束：配图序号只数图片项（视频不参与轮播），混排下标必须经 Map 折算成图片序号；
 * 视频地址为 null 时不进入播放态，直接回原文，避免点了没反应。
 */
import { useCallback, useMemo, useState } from 'react'
import type { WeiboTimelineMedia } from '@shared/types/weibo'
import type { WeiboMediaPreviewItem } from '../block/WeiboMediaPreview'

/** 空混排项：视频数为 0 时复用同一份，避免每次渲染新建数组 */
const EMPTY_MIXED_ITEMS: WeiboTimelineMedia['items'] = []

export interface WeiboMediaViewerController {
    /** 混排项：视频数为 0 时为空数组，调用方据此决定走混排还是纯图片 */
    mixedItems: WeiboTimelineMedia['items']
    /** 展开中的配图序号：null 表示停在宫格 */
    expandedIndex: number | null
    /** 正在原地播放的视频地址：null 表示都停在封面格 */
    playingUrl: string | null
    /** 预览项：复用宫格展示图，展开即命中图片缓存 */
    previewItems: WeiboMediaPreviewItem[]
    /** 混排下标 → 图片序号 */
    previewIndexOfItem: Map<number, number>
    openPreview: (index: number) => void
    closePreview: () => void
    playVideo: (playUrl: string | null) => void
    collapsePlayer: () => void
}

export function useWeiboMediaViewer(media: WeiboTimelineMedia, onOpenPost: () => void): WeiboMediaViewerController {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
    const [playingUrl, setPlayingUrl] = useState<string | null>(null)

    const mixedItems = useMemo(
        () => (media.videoCount > 0 ? media.items : EMPTY_MIXED_ITEMS),
        [media.items, media.videoCount],
    )

    const previewItems = useMemo<WeiboMediaPreviewItem[]>(
        () =>
            mixedItems.length > 0
                ? mixedItems.flatMap((item) =>
                      item.kind === 'image' ? [{ thumbUrl: item.middleUrl, size: item.size }] : [],
                  )
                : media.images.map((originUrl, index) => ({
                      thumbUrl: media.thumbnails[index] ?? originUrl,
                      size: media.sizes[index] ?? null,
                  })),
        [media.images, media.sizes, media.thumbnails, mixedItems],
    )

    const previewIndexOfItem = useMemo(
        () =>
            mixedItems.reduce<Map<number, number>>((map, item, index) => {
                if (item.kind === 'image') {
                    map.set(index, map.size)
                }
                return map
            }, new Map<number, number>()),
        [mixedItems],
    )

    /** 打开预览：下标钳制在图片序号范围内，混排下标折算漏一项时不会把轮播落到空白页 */
    const openPreview = useCallback(
        (index: number): void => {
            if (index < 0 || index >= previewItems.length) {
                return
            }
            setExpandedIndex(index)
        },
        [previewItems.length],
    )

    const closePreview = useCallback((): void => {
        setExpandedIndex(null)
    }, [])

    /** 点视频封面：有整段地址就原地换成播放器，没有就直接回原文，别让人点了没反应 */
    const playVideo = useCallback(
        (playUrl: string | null): void => {
            if (playUrl === null) {
                onOpenPost()
                return
            }
            setPlayingUrl(playUrl)
        },
        [onOpenPost],
    )

    const collapsePlayer = useCallback((): void => {
        setPlayingUrl(null)
    }, [])

    return {
        mixedItems,
        expandedIndex,
        playingUrl,
        previewItems,
        previewIndexOfItem,
        openPreview,
        closePreview,
        playVideo,
        collapsePlayer,
    }
}
