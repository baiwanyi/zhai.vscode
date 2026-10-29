/**
 * 写作管理一次性文本生成：把提示词交给注入的 AI 通道，聚合流式增量并返回完整正文与用量。
 * 复用约定：通道实例由服务层注入（../../ai/provider），本层不感知具体厂商，也不读取凭证；
 * 超时、输出上限与取消信号都由调用方给出，外貌、设定字段与条目描述三类生成共用这一处实现。
 * 关键约束：本层不做提示词清洗与落库，只负责取回正文、用量与请求标识；
 * 内部超时与外部取消任一触发都会中止请求，抛出的错误由服务层转为可读提示。
 */
import type { AiChatMessage, AiProvider, AiUsage, AiUsageMeta } from '@modules/ai/provider'

export interface AiTextGenerateOptions {
    provider: AiProvider
    model: string
    messages: AiChatMessage[]
    /** 输出 token 上限：按字段篇幅由调用方决定 */
    maxTokens: number
    /** 整体超时：通常略大于前端兜底，保证前端不会先于宿主超时 */
    timeoutMs: number
    /** 外部取消信号：由服务层在收到 abort 方法时触发 */
    signal?: AbortSignal
}

export interface AiTextGenerateResult {
    content: string
    usage: AiUsage | null
    /** 请求标识与计费元数据：服务层据此把 CLI 记录里的真实积分回填到用量行 */
    meta: AiUsageMeta | null
}

/** 执行一次文本生成，返回原始正文与用量 */
export async function generateTextWithAi(options: AiTextGenerateOptions): Promise<AiTextGenerateResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    const forwardAbort = (): void => controller.abort()
    if (options.signal) {
        if (options.signal.aborted) {
            controller.abort()
        } else {
            options.signal.addEventListener('abort', forwardAbort, { once: true })
        }
    }
    let content = ''
    let usage: AiUsage | null = null
    let meta: AiUsageMeta | null = null
    try {
        const stream = options.provider.stream({
            model: options.model,
            maxTokens: options.maxTokens,
            messages: options.messages,
            signal: controller.signal,
        })
        for await (const chunk of stream) {
            content += chunk.content
            if (chunk.usage) {
                usage = chunk.usage
            }
            if (chunk.meta) {
                meta = chunk.meta
            }
        }
        return { content, usage, meta }
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
    }
}
