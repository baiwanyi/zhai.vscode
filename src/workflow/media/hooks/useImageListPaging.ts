/**
 * 图片列表分批：把按月分组后的「首屏只挂一批、后续追加」状态机收在一处，供媒体与已下载两类本地列表共用。
 * 复用约定：分组结构取 ./mediaMonth 的 MediaMonthGroup，筛选签名由调用方给出，组件层只消费返回值；
 * 续载入口、按钮文案与滚动观察都交给 layout/imageList 的同族组件，本 hook 不碰 DOM。
 * 关键约束：每组各取前 N 张而非全局切片，组头计数始终取组内总数；筛选签名变化即回到首批，
 * 切走再切回同一组合时保留上次的累计上限；远端分页由搜索 hook 自行持有，不在此列。
 */
import { useCallback, useMemo, useState } from 'react'
import type { MediaMonthGroup } from './mediaMonth'

/** 每组首屏与每次追加的张数：一次只进一屏出头的卡片，避免上百张图同时进 DOM */
const PAGE_SIZE = 60

interface UseImageListPagingOptions<T> {
    groups: readonly MediaMonthGroup<T>[]
    pageSize?: number
    /** 筛选签名：变化时回到首批，同一签名切走再切回保留累计上限 */
    signature?: string
}

interface UseImageListPagingResult<T> {
    visibleGroups: MediaMonthGroup<T>[]
    /** 已渲染张数：按钮进度提示的分子 */
    rendered: number
    /** 筛选结果总张数：按钮进度提示的分母 */
    total: number
    hasMore: boolean
    loadMore: () => void
}

export function useImageListPaging<T>({
    groups,
    pageSize = PAGE_SIZE,
    signature = '',
}: UseImageListPagingOptions<T>): UseImageListPagingResult<T> {
    const [paging, setPaging] = useState({ signature: '', count: pageSize })
    const renderLimit = paging.signature === signature ? paging.count : pageSize

    const visibleGroups = useMemo(
        () => groups.map((group) => ({ ...group, items: group.items.slice(0, renderLimit) })),
        [groups, renderLimit],
    )
    const rendered = visibleGroups.reduce((sum, group) => sum + group.items.length, 0)
    const total = groups.reduce((sum, group) => sum + group.total, 0)
    const hasMore = groups.some((group) => group.total > renderLimit)

    const loadMore = useCallback((): void => {
        setPaging({ signature, count: renderLimit + pageSize })
    }, [pageSize, renderLimit, signature])

    return { visibleGroups, rendered, total, hasMore, loadMore }
}
