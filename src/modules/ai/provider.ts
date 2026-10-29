/**
 * AI 通道契约：抽象「把一组消息流式生成为文本」的能力，供会话服务、取名与外貌生成共用。
 * 复用约定：请求与增量类型保持稳定结构，调用方只依赖本接口，不感知具体实现；
 * 取消统一走 AbortSignal，由实现映射到底层中断手段（CodeBuddy 通道调 interrupt）。
 * 关键约束：实现自行从 SecretsService 读取凭证，不经调用方透传；实现不得持有跨请求状态，
 * 并发隔离交给调用方的 AbortController，避免多入口同时生成时互相串流。
 */

import type { AiContextUsage, AiProviderId } from '@shared/types/aiChat'

/** 通道标识：与 webview 共用的类型来源为 shared/types/aiChat */
export type { AiProviderId } from '@shared/types/aiChat'

/** 对话消息：通道之间通用的最小字段集 */
export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** 单次生成的用量：服务端未返回时由调用方按字符数估算 */
export interface AiUsage {
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
}

/**
 * 请求标识与计费元数据：由通道从 SDK 的 result 消息解析，仅在流末块携带。
 * 关键约束：SDK 的 requestId / messageId 属实验性字段，缺失时为 null；costUsd 为 0 是有效值（订阅账号），
 * 不得当作「未知」，未知一律走 credits 为 null 的表达。
 */
export interface AiUsageMeta {
    /** 通道侧逻辑轮次标识 */
    requestId: string | null
    /** 通道侧单次生成标识 */
    messageId: string | null
    /** 服务端计价（美元） */
    costUsd: number
    /** 总耗时与模型侧耗时（毫秒） */
    durationMs: number
    durationApiMs: number
    cacheReadTokens: number
    cacheCreationTokens: number
}

/** 流式增量：正文与思维链分通道，用量与元数据仅在流末块携带 */
export interface AiStreamChunk {
    content: string
    reasoning: string
    usage?: AiUsage
    meta?: AiUsageMeta
    /** 本轮上下文占用：通道拿不到模型请求的输入用量时缺省，由上层保留上一次的值 */
    context?: AiContextUsage
}

/** 流式生成请求：长度上限按通道能力可被忽略，但调用方始终传入 */
export interface AiStreamRequest {
    model: string
    maxTokens: number
    messages: AiChatMessage[]
    signal: AbortSignal
    /** 续接通道侧会话：传入后只把最后一条用户消息作为本轮输入，历史由通道维护 */
    sessionId?: string
    /** 通道建立或续接会话成功时回传会话号，供上层持久化 */
    onSessionId?: (sessionId: string) => void
}

/** 通道就绪状态：未就绪时 reason 为可直接展示给用户的提示 */
export interface AiProviderStatus {
    ready: boolean
    reason?: string
}

/** 通道实现：每个实例对应一种接入方式，全扩展共用一个实例 */
export interface AiProvider {
    readonly id: AiProviderId
    /** 发送前检查凭据或登录态；实现不得在此发起生成请求 */
    checkReady(): Promise<AiProviderStatus>
    stream(request: AiStreamRequest): AsyncGenerator<AiStreamChunk>
}
