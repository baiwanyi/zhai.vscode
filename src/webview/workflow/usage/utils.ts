/**
 * AI 使用量页展示格式化：时间、积分、tokens、请求 id 与耗时。
 * 复用约定：纯函数、不依赖宿主，便于单测；无效时间返回空串，与 webview 共享的时间展示口径一致。
 * 关键约束：积分未知（null）一律显示破折号，不得回退成 0.00，否则会把未知成本显示成零消耗；
 * 请求 id 在表格中只截短展示，完整值通过 title 与弹窗标题给出。
 */
import { AI_USAGE_MODULE_LABELS } from '@shared/types/aiUsage'
import type { AiUsageModule } from '@shared/types/aiUsage'

/** 请求 id 在表格中的展示长度 */
const SHORT_ID_LENGTH = 8
/** 千 token 的换算基数 */
const TOKEN_UNIT = 1000
/** 毫秒与秒的换算基数 */
const MS_UNIT = 1000

/** 时间展示：本地 `YYYY-MM-DD HH:mm`，便于与用量账单逐条对账 */
export function formatUsageTime(iso: string): string {
    const time = new Date(iso)
    if (Number.isNaN(time.getTime())) {
        return ''
    }
    const pad = (value: number): string => String(value).padStart(2, '0')
    return `${String(time.getFullYear())}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

/** 积分展示：未知返回破折号，已知保留两位小数 */
export function formatCredits(credits: number | null): string {
    return credits === null ? '—' : credits.toFixed(2)
}

/** token 展示：过千折算为 k，保留一位小数 */
export function formatTokens(tokens: number): string {
    if (tokens < TOKEN_UNIT) {
        return String(tokens)
    }
    return `${(tokens / TOKEN_UNIT).toFixed(1)}k`
}

/** 耗时展示：不足一秒用毫秒，否则折算为秒 */
export function formatDuration(durationMs: number): string {
    if (durationMs <= 0) {
        return '—'
    }
    return durationMs < MS_UNIT ? `${String(durationMs)}ms` : `${(durationMs / MS_UNIT).toFixed(1)}s`
}

/** 请求 id 短版：只截前 8 位，尾部加省略号 */
export function shortRequestId(requestId: string): string {
    return requestId.length <= SHORT_ID_LENGTH ? requestId : `${requestId.slice(0, SHORT_ID_LENGTH)}…`
}

/** 模块标签：未登记的键回落到对话，与宿主归一规则一致 */
export function readModuleLabel(module: AiUsageModule): string {
    return AI_USAGE_MODULE_LABELS[module]
}

/** 错误文案：宿主协议错误以 Error 抛出，其余形态兜底转字符串 */
export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}
