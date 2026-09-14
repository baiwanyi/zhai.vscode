/**
 * DeepSeek 流式客户端：基于 openai SDK（DeepSeek 兼容 OpenAI 协议）。
 * 设计源：docs/modules/ai-chat.md 第 5 节——由 SDK 承担流式分帧、重试与错误类型；
 * 取消走 AbortController（AC-2），首字超时由调用方计时并在超限时 abort（AC-7）。
 */
import OpenAI from 'openai'

/** DeepSeek 兼容端点 */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/** 首字等待上限（AC-7） */
export const FIRST_TOKEN_TIMEOUT_MS = 30_000

/** 对话消息（SDK 所需最小字段） */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** 服务端返回的用量（AC-5） */
export interface ChatUsage {
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
}

/** 流式增量：正文与思维链分通道 */
export interface ChatStreamChunk {
    content: string
    reasoning: string
    /** 仅流末块携带，供用量记录 */
    usage?: ChatUsage
}

export interface ChatStreamRequest {
    apiKey: string
    model: string
    temperature: number
    maxTokens: number
    messages: ChatMessage[]
    signal: AbortSignal
}

/**
 * 发起流式对话，逐块产出正文与思维链增量。
 * @throws 密钥无效、网络失败或被 abort 时抛出（由调用方归类为 failed / cancelled）
 */
export async function* streamChat(request: ChatStreamRequest): AsyncGenerator<ChatStreamChunk> {
    const client = new OpenAI({ apiKey: request.apiKey, baseURL: DEEPSEEK_BASE_URL })
    const stream = await client.chat.completions.create(
        {
            model: request.model,
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream: true,
            // 让末块携带 usage，用于 AC-5 的 Token 统计
            stream_options: { include_usage: true },
            messages: request.messages,
        },
        { signal: request.signal },
    )
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        yield {
            content: delta?.content ?? '',
            reasoning: readReasoningContent(delta),
            usage: chunk.usage ? toUsage(chunk.usage) : undefined,
        }
    }
}

/** DeepSeek 在 delta 上额外返回思维链字段，SDK 类型未覆盖，此处做显式收窄 */
function readReasoningContent(delta: unknown): string {
    if (typeof delta !== 'object' || delta === null) {
        return ''
    }
    const value = (delta as { reasoning_content?: unknown }).reasoning_content
    return typeof value === 'string' ? value : ''
}

function toUsage(usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    completion_tokens_details?: { reasoning_tokens?: number } | null
}): ChatUsage {
    return {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens,
    }
}
