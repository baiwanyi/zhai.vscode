/**
 * AI 会话流消息的解析与收窄：把宿主推来的 StreamMessage 归一成可直接分派的联合事件，
 * 并提供流末补丁、压缩消息追加与数值收窄三组纯函数，供会话状态机订阅时调用。
 * 复用约定：消息与步骤类型取 @shared/types/messages 与 @shared/types/aiChat，去重口径沿用宿主下发的消息 id。
 * 关键约束：事件判定顺序即语义优先级（压缩通知 → 流末 → 工具 → 步骤 → 增量），
 * 调换会让增量抢占终态；Webview 侧字段一律逐项判类型，非有限数与负数一律视为未知，不信任载荷。
 */
import { readAiStep } from '@shared/types/aiChat'
import type { AiContextUsage, AiMessage, AiSessionSnapshot, AiStep } from '@shared/types/aiChat'
import type { StreamMessage, StreamNoticeMessage } from '@shared/types/messages'

/** 流消息的归一事件：判定顺序与宿主下发语义一致，订阅方只需按 kind 分派 */
export type AiChatStreamEvent =
    | { kind: 'compacting' }
    | { kind: 'compacted'; notice: StreamNoticeMessage | null }
    | { kind: 'done' }
    | { kind: 'tool'; tool: string }
    | { kind: 'step'; step: AiStep }
    | { kind: 'delta'; channel: 'content' | 'reasoning'; delta: string }
    | { kind: 'ignore' }

/**
 * 归一一条流消息：压缩两态优先于终态，其次是工具活动与步骤快照，最后才是正文 / 思维链增量。
 * 关键约束：判定顺序不可调换 —— 压缩与工具事件的 delta 为空，若先判增量会被当成正文；
 * 步骤载荷不合法时降级为「忽略」，不让一条坏消息打断整轮生成。
 */
export function readStreamEvent(message: StreamMessage): AiChatStreamEvent {
    if (message.notice === 'compacting') {
        return { kind: 'compacting' }
    }
    if (message.notice === 'compacted') {
        return { kind: 'compacted', notice: message.noticeMessage ?? null }
    }
    if (message.done) {
        return { kind: 'done' }
    }
    if (message.tool !== undefined) {
        return { kind: 'tool', tool: message.tool }
    }
    if (message.step !== undefined) {
        const step = readAiStep(message.step)
        return step === null ? { kind: 'ignore' } : { kind: 'step', step }
    }
    if (message.delta.length === 0) {
        return { kind: 'ignore' }
    }
    return {
        kind: 'delta',
        channel: message.channel === 'reasoning' ? 'reasoning' : 'content',
        delta: message.delta,
    }
}

/**
 * 流末补丁：以宿主回传的完整值校正逐字累积结果，未回传的字段保留原值。
 * 关键约束：status 缺省按 completed 落定；用量与耗时只在流末下发一次，逐项收窄后再并入。
 */
export function applyDonePatch(message: AiMessage, stream: StreamMessage): AiMessage {
    return {
        ...message,
        content: stream.content ?? message.content,
        reasoning: stream.reasoning ?? message.reasoning,
        status: stream.status ?? 'completed',
        error: stream.error ?? null,
        totalTokens: readStreamNumber(stream.usage?.totalTokens, message.totalTokens),
        durationMs: readStreamNumber(stream.durationMs, message.durationMs),
        tokensEstimated: stream.tokensEstimated === true,
        credits: readStreamCredits(stream.credits, message.credits),
    }
}

/**
 * 追加压缩完成标记：按 id 去重后并入消息流末尾。
 * 关键约束：快照刷新与流内追加可能命中同一条，不按 id 去重会让分隔标记出现两次。
 */
export function appendNoticeMessage(
    session: AiSessionSnapshot | null,
    notice: StreamNoticeMessage,
): AiSessionSnapshot | null {
    if (session === null || session.messages.some((item) => item.id === notice.id)) {
        return session
    }
    return {
        ...session,
        messages: [...session.messages, toNoticeMessage(session.conversation.id, notice)],
    }
}

/**
 * 流末上下文用量收窄：两项都必须是有限非负数才采纳。
 * 任一不合格返回 null 表示未回传，由调用方保留上一次的值。
 */
export function readContextUsage(value: unknown): AiContextUsage | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const { usedTokens, windowTokens } = value as { usedTokens?: unknown; windowTokens?: unknown }
    if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens) || usedTokens < 0) {
        return null
    }
    if (typeof windowTokens !== 'number' || !Number.isFinite(windowTokens) || windowTokens < 0) {
        return null
    }
    return { usedTokens, windowTokens }
}

/**
 * 流末数值收窄：非有限数或负数一律视为未知，沿用消息上已有的值（历史消息为 0，渲染层据此不展示）。
 */
export function readStreamNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** 流末积分收窄：null 是「明确未知」而不是 0，原样并入；缺省（undefined）沿用原值 */
export function readStreamCredits(credits: number | null | undefined, fallback: number | null): number | null {
    return typeof credits === 'number' && Number.isFinite(credits) ? credits : fallback
}

/**
 * 系统事件消息转展示消息：宿主只下发展示与去重需要的字段，其余按「无推理、无引用、无用量」补齐。
 * 关键约束：status 恒为 completed —— 系统消息没有在途态，误判会出现多余的加载占位。
 */
function toNoticeMessage(conversationId: string, notice: StreamNoticeMessage): AiMessage {
    return {
        id: notice.id,
        conversationId,
        role: 'system',
        content: notice.content,
        reasoning: null,
        steps: [],
        status: 'completed',
        finishReason: notice.kind,
        error: null,
        refs: [],
        totalTokens: 0,
        durationMs: 0,
        tokensEstimated: false,
        credits: null,
        createdAt: notice.createdAt,
    }
}
