/**
 * AI 通道契约：抽象「把一组消息流式生成为文本」的能力，供会话服务、取名与外貌生成共用。
 * 复用约定：请求与增量类型与既有 DeepSeek 客户端保持结构一致，调用方只依赖本接口，不感知具体厂商；
 * 取消统一走 AbortSignal，由各实现映射到底层中断手段（直连断开连接、Agent 通道调 interrupt）。
 * 关键约束：实现自行从 SecretsService 读取凭证，不经调用方透传；实现不得持有跨请求状态，
 * 并发隔离交给调用方的 AbortController，避免多入口同时生成时互相串流。
 */

/** 通道标识：配置项 zhai.ai.provider 的取值来源 */
export type AiProviderId = 'deepseek' | 'codebuddy'

/** 对话消息：与 OpenAI 协议一致的最小字段集 */
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

/** 流式增量：正文与思维链分通道，用量仅在流末块携带 */
export interface AiStreamChunk {
    content: string
    reasoning: string
    usage?: AiUsage
}

/** 流式生成请求：温度与长度上限按通道能力可被忽略，但调用方始终传入 */
export interface AiStreamRequest {
    model: string
    temperature: number
    maxTokens: number
    messages: AiChatMessage[]
    signal: AbortSignal
}

/** 通道实现：每个实例对应一种接入方式，全扩展共用一个实例 */
export interface AiProvider {
    readonly id: AiProviderId
    stream(request: AiStreamRequest): AsyncGenerator<AiStreamChunk>
}
