/**
 * 人物外貌生成执行器：调用 DeepSeek 流式接口完成一次性生成，把增量聚合为完整正文。
 * 复用约定：底层复用 ../../ai/client 的 streamChat（OpenAI 兼容协议），密钥与模型由调用方注入；
 * 取消走 AbortController，外部 signal（press/aiAppearance/abort）与内部超时都会中止请求。
 * 关键约束：本函数不做提示词清洗与落库，只负责取回正文与用量；抛出的错误由服务层转为可读提示。
 */
import { buildAppearanceMessages } from './appearancePrompt'
import type { CharacterAppearanceRequest } from '../../../shared/types/press'
import type { ChatUsage } from '../../ai/client'
import { streamChat } from '../../ai/client'

/** 单次生成整体超时：一段白描通常 3~8s，留出充足余量 */
const AI_REQUEST_TIMEOUT_MS = 60_000
/** 描写类任务温度：略高于默认值，保留用词差异 */
const AI_TEMPERATURE = 0.9
/** 单次输出上限：200 字约 400 token，留一倍余量 */
const AI_MAX_TOKENS = 500

export interface AiAppearanceGenerateOptions {
    apiKey: string
    model: string
    request: CharacterAppearanceRequest
    /** 外部取消信号（press/aiAppearance/abort） */
    signal?: AbortSignal
}

export interface AiAppearanceGenerateResult {
    content: string
    usage: ChatUsage | null
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
    let usage: ChatUsage | null = null
    try {
        const stream = streamChat({
            apiKey: options.apiKey,
            model: options.model,
            temperature: AI_TEMPERATURE,
            maxTokens: AI_MAX_TOKENS,
            messages: buildAppearanceMessages(options.request),
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
