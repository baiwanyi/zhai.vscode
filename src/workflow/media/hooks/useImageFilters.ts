/**
 * 媒体页筛选：把「年月 / 关联状态」两个维度与按月分组收在一处，分批交给统一分页 hook。
 * 复用约定：数据全部来自 media/list 的全量返回，筛选在内存完成；年月格式化与分组取 ./mediaMonth，
 * 分批取 ./useImageListPaging，年月选项与分组数据共用同一份格式化口径。
 * 关键约束：默认「全部月份 + 全部关联」+ 按月倒序分组，进页面即见全库；
 * 关联判定只看 usageCount（media_usage 有行即已关联），不额外请求引用明细；
 * 筛选签名变化即让分批回到首批，切回同一组合时保留上次的累计上限，组内沿用宿主返回的时间倒序。
 */
import { useMemo, useState } from 'react'
import type { MediaItem } from '@shared/types/media'
import { formatMediaMonth, groupByMonth, type MediaMonthGroup } from './mediaMonth'
import { useImageListPaging } from './useImageListPaging'

/** 关联筛选：全部 / 已关联（usageCount > 0）/ 未关联 */
export type MediaLinkFilter = 'all' | 'linked' | 'unlinked'

/** 媒体分组：统一年月分组在媒体条目上的具化，供页面与适配器共用 */
export type MediaGroup = MediaMonthGroup<MediaItem>

interface UseMediaFiltersParams {
    /** 全部媒体：筛选、分组与计数的唯一数据源 */
    items: MediaItem[]
}

interface UseMediaFiltersResult {
    /** 当前年月：null 表示全部月份 */
    month: string | null
    setMonth: (month: string | null) => void
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
    const [link, setLink] = useState<MediaLinkFilter>('all')

    /** 两维组合筛选：条件互斥且都是内存判断，任一维度变化都同步反映到分组与分批 */
    const filtered = useMemo(
        () =>
            items.filter((item) => {
                if (month !== null && item.month !== month) {
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
        [items, month, link],
    )

    /**
     * 分组：单选某月时只有一组；全部月份时按年月倒序分桶。
     * 空月不建组——下拉里仍会显示该月计数，进组却没有内容会让人误以为列表没加载出来。
     */
    const groups = useMemo<MediaGroup[]>(() => {
        if (month !== null) {
            return filtered.length === 0
                ? []
                : [{ month, label: formatMediaMonth(month), items: filtered, total: filtered.length }]
        }
        return groupByMonth(filtered)
    }, [filtered, month])

    /** 分批：筛选签名变化即由统一分页 hook 回到首批，本模块不再自持上限 */
    const filterSignature = `${month ?? 'all'}|${link}`
    const { visibleGroups, hasMore, loadMore } = useImageListPaging({ groups, signature: filterSignature })

    const clearFilters = (): void => {
        setMonth(null)
        setLink('all')
    }

    return {
        month,
        setMonth,
        link,
        setLink,
        filtered,
        groups,
        visibleGroups,
        hasMore,
        hasActiveFilter: month !== null || link !== 'all',
        clearFilters,
        filterSignature,
        loadMore,
    }
}
