/**
 * 公众号批次列表的筛选与排序口径：选项文案与入参收窄同源，页面、hooks 与后续分区共用。
 * 复用约定：筛选值只认本文件登记的档位，收窄用查找返回而非类型断言，非法值回落默认档。
 * 关键约束：新增档位只改这一处，避免「选项里有、收窄里缺」导致用户选择被静默忽略；
 * 本文件只导出常量与纯函数，不含组件与请求，便于被任意展示层引用。
 */

/** 状态筛选：只暴露最常用的四档，其余状态并入「全部」 */
export type IssueFilter = 'all' | 'draft' | 'published' | 'failed'

/** 排序方式：最近更新或推送时间，后者把未推送的排在末尾 */
export type IssueSort = 'updated' | 'published'

/** 筛选选项与文案 */
export const FILTER_OPTIONS: readonly { value: IssueFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'draft', label: '草稿' },
    { value: 'published', label: '已推送' },
    { value: 'failed', label: '推送失败' },
]

/** 排序选项与文案 */
export const SORT_OPTIONS: readonly { value: IssueSort; label: string }[] = [
    { value: 'updated', label: '最近更新' },
    { value: 'published', label: '推送时间' },
]

/** 收窄筛选回传值：非法值回落到「全部」，避免把任意字符串当成筛选条件 */
export function readIssueFilter(value: string): IssueFilter {
    return FILTER_OPTIONS.find((item) => item.value === value)?.value ?? 'all'
}

/** 收窄排序回传值：只认「推送时间」，其余一律按最近更新 */
export function readIssueSort(value: string): IssueSort {
    return value === 'published' ? 'published' : 'updated'
}
