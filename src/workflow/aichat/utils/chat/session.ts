/**
 * AI 会话快照的不可变更新：就地替换指定消息，以及按 id 合并工具步骤快照。
 * 复用约定：会话、消息与步骤类型取 @shared/types/aiChat，一律返回新对象、不改动入参，供会话状态机直接落入 React 状态。
 * 关键约束：消息替换保持其余引用不变；步骤覆盖必须保序 —— 后到的状态更新不应把已完成的步骤跳到列表末尾。
 */
import type { AiMessage, AiSessionSnapshot, AiStep } from '@shared/types/aiChat'

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

/**
 * 合并一条步骤快照：同 id 覆盖原位置，新 id 追加到末尾。
 * 关键约束：覆盖必须保序 —— 后到的状态更新不应把已完成的步骤跳到列表末尾。
 */
export function upsertStep(steps: AiStep[], incoming: AiStep): AiStep[] {
    const index = steps.findIndex((step) => step.id === incoming.id)
    if (index < 0) {
        return [...steps, incoming]
    }
    const next = [...steps]
    next[index] = incoming
    return next
}
