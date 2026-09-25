/**
 * AI 对话展示层纯函数：相对时间格式化（原生 Intl.RelativeTimeFormat，7 天内用相对时间、更早回退本地日期）、
 * token 数与引用字数的紧凑折算、未知错误的文本收窄。
 * 零依赖、无副作用，可被页面主组件与各子组件自由复用；展示规则与 docs/modules/ai-chat.md 第 10 节一致。
 */
import type { AiContextRef } from '@/shared/types/aiChat'

/** 相对时间格式化器（原生 Intl，不引日期库） */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

/** 会话时间的展示：7 天内用相对时间，更早回退本地日期 */
export function formatRelativeTime(iso: string): string {
    const time = new Date(iso).getTime()
    if (Number.isNaN(time)) {
        return ''
    }
    const minutes = Math.round((time - Date.now()) / 60_000)
    if (Math.abs(minutes) < 60) {
        return RELATIVE_TIME_FORMATTER.format(minutes, 'minute')
    }
    const hours = Math.round(minutes / 60)
    if (Math.abs(hours) < 24) {
        return RELATIVE_TIME_FORMATTER.format(hours, 'hour')
    }
    const days = Math.round(hours / 24)
    if (Math.abs(days) < 7) {
        return RELATIVE_TIME_FORMATTER.format(days, 'day')
    }
    return new Date(iso).toLocaleDateString('zh-CN')
}

/** token 数量紧凑展示：过千折算 k，过百万折算 M */
export function formatTokens(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}k`
    }
    return String(value)
}

export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 引用体积描述：过千折算 k，被截断时追加标注 */
export function describeContext(ref: AiContextRef): string {
    const size = ref.charCount >= 1000 ? `${(ref.charCount / 1000).toFixed(1)}k 字` : `${ref.charCount} 字`
    return ref.isTruncated ? `${size} · 已截断` : size
}
