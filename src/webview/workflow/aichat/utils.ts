/**
 * AI 对话展示层纯函数：token 数与引用字数的紧凑折算、未知错误的文本收窄、
 * 会话快照的不可变消息替换、宿主 state 广播载荷的收窄。
 * 零依赖、无副作用，可被页面主组件与各子组件自由复用；展示规则与 docs/modules/ai-chat.md 第 10 节一致。
 * 关键约束：相对时间格式化已上移至 src/webview/utils.ts 供各 Webview 共用；readAiStateKind 只信任收窄结果。
 */
import type { AiContextRef, AiMessage, AiSessionSnapshot } from '@/shared/types/aiChat'

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

/** 就地替换指定消息，保持其余引用不变 */
export function patchMessage(
    session: AiSessionSnapshot | null,
    messageId: string,
    patch: (message: AiMessage) => AiMessage,
): AiSessionSnapshot | null {
    if (!session) {
        return session
    }
    return {
        ...session,
        messages: session.messages.map((item) => (item.id === messageId ? patch(item) : item)),
    }
}

/** 收窄宿主 state 广播的载荷：仅识别 ai 通道的两类通知 */
export function readAiStateKind(payload: unknown): 'runtime' | 'context' | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const kind = (payload as { kind?: unknown }).kind
    return kind === 'runtime' || kind === 'context' ? kind : null
}
