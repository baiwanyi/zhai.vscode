/**
 * 视图选项：从元数据派生下拉数据，顺序与 WECHAT_STATS_VIEWS 一致。
 * 只按维度过滤，不拼接提示文案。
 */
import type { WechatStatsDimension, WechatStatsView } from '@shared/types/wechat'
import { WECHAT_STATS_VIEW_META, WECHAT_STATS_VIEWS } from '@shared/types/wechat'

/** 下拉选项：value 受 WechatStatsView 约束，label 取元数据展示名 */
export interface StatsViewOption {
    value: WechatStatsView
    label: string
}

/** 按维度取视图选项：顺序与共享枚举一致 */
export function readStatsViewOptions(dimension: WechatStatsDimension): readonly StatsViewOption[] {
    return WECHAT_STATS_VIEWS.filter((view) => WECHAT_STATS_VIEW_META[view].dimension === dimension).map((view) => ({
        value: view,
        label: WECHAT_STATS_VIEW_META[view].label,
    }))
}
