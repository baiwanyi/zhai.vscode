/**
 * 指标选择与明细取值：纯函数，无 React 依赖。
 * activeKey 未命中回落首个指标；明细 key 缺失取 0，不回落到别的指标。
 */
import type { WechatStatsItem, WechatStatsMetric } from '@shared/types/wechat'

/** 选择当前指标：命中 activeKey 优先，否则回落首个，空列表返回 undefined */
export function readSelectedMetric(
    metrics: readonly WechatStatsMetric[],
    activeKey: string,
): WechatStatsMetric | undefined {
    return metrics.find((item) => item.key === activeKey) ?? metrics[0]
}

/** 从逐项明细按 key 取值：key 缺省或非有限数统一回落 0 */
export function readItemValue(item: WechatStatsItem, key: string | undefined): number {
    if (key === undefined) {
        return 0
    }
    const value = item.values[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
