/**
 * 用户描述文案：关注状态与关注时间的展示口径。
 * 复用约定：纯字符串处理，时间格式化复用 shared/utils/format，可在界面与测试里直接复用。
 * 关键约束：非法或缺失的关注时间统一回落「关注时间未知」，不向用户暴露空尾文案。
 */
import type { WechatFanSummary } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'

/** 关注状态文案：已取关直接给出，否则拼上相对时间 */
export function formatFollowText(fan: WechatFanSummary): string {
    if (fan.subscribeStatus === 0) {
        return '已取关'
    }
    if (fan.subscribedAt === undefined) {
        return '关注时间未知'
    }
    const relative = formatRelativeTime(fan.subscribedAt)
    return relative.length === 0 ? '关注时间未知' : `关注于 ${relative}`
}
