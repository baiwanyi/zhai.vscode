/**
 * 年月工具：把媒体、图库与上传三处共用的年月格式化、下拉选项与按月分组收在一处。
 * 复用约定：年月文案统一由 formatMediaMonth 产出，下拉选项取宿主的 MediaMonthCount 聚合，
 * 分组结构为通用的 MediaMonthGroup，调用方只需提供带 month 字段的条目。
 * 关键约束：分组键按年月倒序排列、组内顺序完全沿用入参（宿主已按时间倒序），前端不再二次排序；
 * 本模块不做筛选与去重，空月不建组，计数取该组真实条目数而非分批后的已渲染数。
 */
import type { MediaMonthCount } from '@shared/types/media'

/** 年月格式化：下拉选项与分组头共用，月份不补零 */
export function formatMediaMonth(month: string): string {
    const [year, value] = month.split('-')
    if (year === undefined || value === undefined) {
        return month
    }
    return `${year}年${Number(value)}月`
}

/** 年月下拉选项：'all' 表示全部月份 */
export interface MediaMonthOption {
    value: string
    label: string
    count: number
}

/** 由宿主聚合生成下拉选项：全部月份排首位，其余沿用宿主的年月倒序 */
export function toMonthOptions(months: readonly MediaMonthCount[], total: number): MediaMonthOption[] {
    return [
        { value: 'all', label: '全部月份', count: total },
        ...months.map((item) => ({
            value: item.month,
            label: formatMediaMonth(item.month),
            count: item.count,
        })),
    ]
}

/** 按月分组后的结构：组头与卡片列表共用 */
export interface MediaMonthGroup<T> {
    /** YYYY-MM */
    month: string
    /** 中文显示：2026年10月 */
    label: string
    items: T[]
    total: number
}

/** 按月分桶：空月不建组，分组键倒序，组内沿用入参顺序 */
export function groupByMonth<T extends { month: string }>(items: readonly T[]): MediaMonthGroup<T>[] {
    const buckets = new Map<string, T[]>()
    for (const item of items) {
        const list = buckets.get(item.month) ?? []
        list.push(item)
        buckets.set(item.month, list)
    }
    return [...buckets.entries()]
        .sort((left, right) => right[0].localeCompare(left[0]))
        .map(([month, list]) => ({
            month,
            label: formatMediaMonth(month),
            items: list,
            total: list.length,
        }))
}
