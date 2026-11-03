/**
 * 媒体页筛选与分批：把「年月 / 来源 / 关联状态」三个维度、按月分组与分批上限收在一处。
 * 复用约定：数据全部来自 media/list 的全量返回，筛选与分组都在内存完成，切换任一维度不重新请求；
 * 年月文案统一走 formatMediaMonth，下拉选项与分组头共用同一份格式化，避免两处口径不同。
 * 关键约束：默认「全部月份 + 全部来源 + 全部关联」+ 按月倒序分组，进页面即见全库；
 * 关联判定只看 usageCount（media_usage 有行即已关联），不额外请求引用明细；
 * 分批以筛选签名为界，三维任一变化即回到首批，切回同一组合时保留上次的累计上限；
 * 分组内的顺序完全采用宿主返回的顺序（时间倒序），前端不再二次排序。
 */
import { useMemo, useState } from 'react'
import type { MediaItem, MediaMonthCount, MediaOrigin } from '@shared/types/media'

/** 来源筛选：全部 / 上传 / 生图，与 MediaOrigin 两值一一对应 */
export type MediaOriginFilter = 'all' | MediaOrigin
/** 关联筛选：全部 / 已关联（usageCount > 0）/ 未关联 */
export type MediaLinkFilter = 'all' | 'linked' | 'unlinked'

/** 每组网格首屏与每次追加的张数：一次只进一屏出头的卡片，避免上百张图同时进 DOM */
const GRID_PAGE_SIZE = 60

/** 按月分组：组头与卡片列表共用一份结构 */
export interface MediaGroup {
    /** YYYY-MM */
    month: string
    /** 中文显示：2026年10月 */
    label: string
    items: MediaItem[]
    total: number
}

/** 年月格式化：下拉与分组头共用，月份不补零 */
export function formatMediaMonth(month: string): string {
    const [year, value] = month.split('-')
    if (year === undefined || value === undefined) {
        return month
    }
    return `${year}年${Number(value)}月`
}

interface UseMediaFiltersParams {
    /** 全部媒体：筛选、分组与计数的唯一数据源 */
    items: MediaItem[]
}

interface UseMediaFiltersResult {
    /** 当前年月：null 表示全部月份 */
    month: string | null
    setMonth: (month: string | null) => void
    /** 当前来源：all 表示不筛 */
    origin: MediaOriginFilter
    setOrigin: (origin: MediaOriginFilter) => void
    /** 当前关联状态：all 表示不筛 */
    link: MediaLinkFilter
    setLink: (link: MediaLinkFilter) => void
    /** 当前筛选结果：批量删除按它取交集，不受分批上限影响 */
    filtered: MediaItem[]
    /** 全部月份下的分组（含空月不出现），按年月倒序 */
    groups: MediaGroup[]
    /** 已渲染的部分：每组各取前 N 张 */
    visibleGroups: MediaGroup[]
    /** 是否还有未渲染的图片 */
    hasMore: boolean
    /** 是否存在生效中的筛选：决定是否显示「清空筛选」 */
    hasActiveFilter: boolean
    clearFilters: () => void
    /** 当前筛选签名：选中集合与分批上限都以它为界 */
    filterSignature: string
    /** 追加下一批 */
    loadMore: () => void
}

export function useImageFilters({ items }: UseMediaFiltersParams): UseMediaFiltersResult {
    const [month, setMonth] = useState<string | null>(null)
    const [origin, setOrigin] = useState<MediaOriginFilter>('all')
    const [link, setLink] = useState<MediaLinkFilter>('all')

    /** 三维组合筛选：条件互斥且都是内存判断，任一维度变化都同步反映到分组与分批 */
    const filtered = useMemo(
        () =>
            items.filter((item) => {
                if (month !== null && item.month !== month) {
                    return false
                }
                if (origin !== 'all' && item.origin !== origin) {
                    return false
                }
                if (link === 'linked' && item.usageCount === 0) {
                    return false
                }
                if (link === 'unlinked' && item.usageCount > 0) {
                    return false
                }
                return true
            }),
        [items, month, origin, link],
    )

    /**
     * 分组：单选某月时只有一组；全部月份时按宿主返回的年月顺序分桶。
     * 空月不建组——下拉里仍会显示该月计数，进组却没有内容会让人误以为列表没加载出来。
     */
    const groups = useMemo<MediaGroup[]>(() => {
        if (month !== null) {
            return filtered.length === 0
                ? []
                : [{ month, label: formatMediaMonth(month), items: filtered, total: filtered.length }]
        }
        const buckets = new Map<string, MediaItem[]>()
        for (const item of filtered) {
            const list = buckets.get(item.month) ?? []
            list.push(item)
            buckets.set(item.month, list)
        }
        return [...buckets.entries()]
            .sort((left, right) => right[0].localeCompare(left[0]))
            .map(([key, list]) => ({
                month: key,
                label: formatMediaMonth(key),
                items: list,
                total: list.length,
            }))
    }, [filtered, month])

    /** 分批：用筛选签名比对而不是在各处 onChange 里重置，筛选一变即自然回到首批 */
    const [paging, setPaging] = useState({ signature: '', count: GRID_PAGE_SIZE })
    const filterSignature = `${month ?? 'all'}|${origin}|${link}`
    const renderLimit = paging.signature === filterSignature ? paging.count : GRID_PAGE_SIZE

    const visibleGroups = useMemo(
        () => groups.map((group) => ({ ...group, items: group.items.slice(0, renderLimit) })),
        [groups, renderLimit],
    )

    const hasMore = groups.some((group) => group.total > renderLimit)

    const loadMore = (): void => {
        setPaging({ signature: filterSignature, count: renderLimit + GRID_PAGE_SIZE })
    }

    const clearFilters = (): void => {
        setMonth(null)
        setOrigin('all')
        setLink('all')
    }

    return {
        month,
        setMonth,
        origin,
        setOrigin,
        link,
        setLink,
        filtered,
        groups,
        visibleGroups,
        hasMore,
        hasActiveFilter: month !== null || origin !== 'all' || link !== 'all',
        clearFilters,
        filterSignature,
        loadMore,
    }
}

/** 年月选项：把宿主聚合与当前格式化拼成下拉数据，组件层不再自己拼文案 */
export interface MediaMonthOption {
    /** 'all' 表示全部月份 */
    value: string
    label: string
    count: number
}

/** 由宿主聚合生成下拉选项：全部月份排首位，其余按年月倒序 */
export function toMonthOptions(months: MediaMonthCount[], total: number): MediaMonthOption[] {
    return [
        { value: 'all', label: '全部月份', count: total },
        ...months.map((item) => ({
            value: item.month,
            label: formatMediaMonth(item.month),
            count: item.count,
        })),
    ]
}
