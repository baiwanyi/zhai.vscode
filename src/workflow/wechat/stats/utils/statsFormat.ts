/**
 * 统计页展示口径：千分位、耗时与链接白名单。
 * 耗时复用 formatDuration，链接复用 parseOpenableUrl；非有限数回落 0。
 */
import type { WechatStatsMetric } from '@shared/types/wechat'
import { formatDuration } from '@shared/utils/format'
import { parseOpenableUrl } from '@shared/utils/url'

/** 千分位格式化：计数与分布值共用 */
const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN')

/** 纯数字展示：非有限数回落为 0，避免 NaN 出现在界面 */
export function formatStatsNumber(value: number): string {
    return NUMBER_FORMAT.format(Number.isFinite(value) ? value : 0)
}

/** 按指标格式展示：耗时走共享口径（如 1.2s），计数走千分位 */
export function formatStatsValue(metric: WechatStatsMetric, value: number): string {
    return metric.format === 'duration' ? formatDuration(value) : formatStatsNumber(value)
}

/** 分类分布条宽占比：按峰值归一，非有限数与负数一律回落 0 */
export function readBreakdownRatio(value: number, peak: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(peak) || peak <= 0) {
        return 0
    }
    return Math.max(0, (value / peak) * 100)
}

/** 倒序副本：不改原数组，供逐项与逐日明细共用 */
export function readReversed<T>(items: readonly T[]): T[] {
    return [...items].reverse()
}

/** 文章链接白名单：解析后按 hostname 精确匹配微信文章域名 */
export function readArticleUrl(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined
    }
    const parsed = parseOpenableUrl(value)
    if (parsed === null) {
        return undefined
    }
    try {
        return new URL(parsed).hostname === 'mp.weixin.qq.com' ? parsed : undefined
    } catch {
        return undefined
    }
}
