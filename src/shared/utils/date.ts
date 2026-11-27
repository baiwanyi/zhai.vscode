/**
 * 日期键工具：本地日期与 YYYY-MM-DD 字符串的互转，供 Webview 与宿主服务共用。
 * 复用约定：均为无副作用的纯函数，不引入日期库；调用方按所在进程选择本地或 UTC 口径。
 * 关键约束：本地日期键用 getFullYear/getMonth/getDate 生成，避免 toISOString 的 UTC 偏移把日期算错一天。
 */

/** 本地日期转 YYYY-MM-DD 键：统计区间与平台按自然日对齐的口径 */
export function formatDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${String(date.getFullYear())}-${month}-${day}`
}

/** 昨天日期键：当天数据未结算，统计区间终点一律取昨天 */
export function readYesterdayKey(now: Date = new Date()): string {
    return formatDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
}
