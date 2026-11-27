/**
 * 用户状态判定：把黑名单与关注状态两个维度收敛为界面互斥三态。
 * 复用约定：纯函数，只依赖 WechatFanSummary 字段，不依赖 React 与宿主协议，可在界面与测试里直接复用。
 * 关键约束：拉黑优先于关注状态，同时被拉黑且仍关注的用户按已拉黑展示，避免两处状态同时高亮。
 */
import type { WechatFanSummary } from '@shared/types/wechat'

/** 界面互斥三态 */
export type FanStatus = 'blocked' | 'subscribed' | 'unsubscribed'

/** 把用户摘要收敛为单一展示状态：拉黑 > 取关 > 关注 */
export function readFanStatus(fan: WechatFanSummary): FanStatus {
    if (fan.isBlocked) {
        return 'blocked'
    }
    return fan.subscribeStatus === 0 ? 'unsubscribed' : 'subscribed'
}
