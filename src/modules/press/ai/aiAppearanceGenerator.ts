/**
 * 人物外貌生成执行器：经 AI 通道完成一次性生成，把增量聚合为完整正文。
 * 复用约定：通道实例由服务层注入（../../ai/provider），本层不感知具体厂商，也不读取凭证；
 * 取消走 AbortController，外部 signal（press/aiAppearance/abort）与内部超时都会中止请求。
 * 关键约束：本函数不做提示词清洗与落库，只负责取回正文、用量与请求标识；抛出的错误由服务层转为可读提示。
 */
import type { AiProvider, AiUsage, AiUsageMeta } from '@modules/ai/provider'
import type { CharacterAppearanceRequest } from '@shared/types/press'
import { buildAppearanceMessages } from './appearancePrompt'

/** 单次生成整体超时：一段白描通常 3~8s，留出充足余量 */
const AI_REQUEST_TIMEOUT_MS = 60_000
/** 单次输出上限：200 字约 400 token，留一倍余量 */
const AI_MAX_TOKENS = 500

export interface AiAppearanceGenerateOptions {
    provider: AiProvider
    model: string
    request: CharacterAppearanceRequest
    /** 外部取消信号（press/aiAppearance/abort） */
    signal?: AbortSignal
}

export interface AiAppearanceGenerateResult {
    content: string
    usage: AiUsage | null
    /** 请求标识与计费元数据：服务层据此把 CLI 记录里的真实积分回填到用量行 */
    meta: AiUsageMeta | null
}

/** 执行一次人物外貌生成，返回原始正文与用量 */
export async function generateAppearanceWithAi(
    options: AiAppearanceGenerateOptions,
): Promise<AiAppearanceGenerateResult> {
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
    let meta: AiUsageMeta | null = null
    try {
        const stream = options.provider.stream({
            model: options.model,
            maxTokens: AI_MAX_TOKENS,
            messages: buildAppearanceMessages(options.request),
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
