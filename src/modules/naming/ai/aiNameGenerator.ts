/**
 * AI 取名执行器：经 AI 通道完成一次性生成，把增量聚合为完整正文后交给提示词层校验。
 * 复用约定：通道实例由服务层注入（../../ai/provider），本层不感知具体厂商，也不读取凭证；
 * 取消走 AbortController，外部 signal（naming/abort）与内部超时都会中止请求。
 * 关键约束：本函数不做结果校验与落库，只负责取回正文与用量；抛出的错误由服务层转为可读提示。
 */
import { buildNamingMessages } from './namingPrompt'
import type { NamingRequest } from '../../../shared/types/naming'
import type { AiUsage, AiProvider } from '../../ai/provider'

/** 单次生成整体超时：批量 24~48 个名字通常 5~15s，留出充足余量 */
const AI_REQUEST_TIMEOUT_MS = 60_000
/** 单次输出上限：批量 48 个名字约 400 token，留一倍余量 */
const AI_MAX_TOKENS = 900

export interface AiNameGenerateOptions {
    provider: AiProvider
    model: string
    request: NamingRequest
    /** 外部取消信号（naming/abort） */
    signal?: AbortSignal
}

export interface AiNameGenerateResult {
    content: string
    usage: AiUsage | null
}

/** 执行一次 AI 取名请求，返回原始正文与用量 */
export async function generateNamesWithAi(options: AiNameGenerateOptions): Promise<AiNameGenerateResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)
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
    try {
        const stream = options.provider.stream({
            model: options.model,
            maxTokens: AI_MAX_TOKENS,
            messages: buildNamingMessages(options.request),
            signal: controller.signal,
        })
        for await (const chunk of stream) {
            content += chunk.content
            if (chunk.usage) {
                usage = chunk.usage
            }
        }
        return { content, usage }
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
    }
}
