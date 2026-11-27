/**
 * 自定义区间校验：合法返回 null，否则返回提示文案。
 * 规则：终点不晚于昨天、跨度≤30 天、不早于数据起始日。
 */
import type { WechatStatsViewMeta } from '@shared/types/wechat'

/** 一天的毫秒数 */
const DAY_MS = 86_400_000

/** 前端只做拦截，宿主仍会复核 */
export function readCustomRangeError(
    beginDate: string,
    endDate: string,
    meta: WechatStatsViewMeta,
    yesterday: string,
): string | null {
    if (beginDate.length === 0 || endDate.length === 0) {
        return '请选择起止日期'
    }
    if (beginDate > endDate) {
        return '开始日期晚于结束日期'
    }
    if (endDate > yesterday) {
        return `结束日期不能晚于 ${yesterday}（当天未结算）`
    }
    const span = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${beginDate}T00:00:00Z`)) / DAY_MS
    if (!Number.isFinite(span)) {
        return '日期格式有误'
    }
    if (span > 30) {
        return '最多查询 30 天'
    }
    if (endDate < meta.since) {
        return `${meta.label}自 ${meta.since} 起记录`
    }
    return null
}
