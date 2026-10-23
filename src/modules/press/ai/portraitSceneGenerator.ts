/**
 * 场景描述执行器：经 AI 通道完成一次性生成，把增量聚合为整段画面描述，并回传用量与请求标识。
 * 复用约定：通道实例由服务层注入（../../ai/provider），本层不感知厂商、不读取凭证；
 * 取消走 AbortController，内部超时与外部 signal 都会中止请求。
 * 关键约束：本层不做清洗、不落库、不计配额；任何异常都向调用方抛出，由服务层决定是否回退到纯模板；
 * 每次调用都必须带上本次变化方向，同一人物重复出图时这是避免画面雷同的唯一输入差异。
 */
import { buildSceneMessages } from './portraitScenePrompt'
import type { PortraitVariation } from './portraitVariation'
import type { PortraitGenerateRequest } from '../../../shared/types/press'
import type { AiProvider, AiUsage, AiUsageMeta } from '../../ai/provider'

/** 单次生成整体超时：一句画面描述通常 2~5s，留出充足余量 */
const AI_REQUEST_TIMEOUT_MS = 25_000
/** 单次输出上限：120 字约 240 token，留一倍余量 */
const AI_MAX_TOKENS = 320

export interface SceneGenerateOptions {
    provider: AiProvider
    model: string
    request: PortraitGenerateRequest
    /** 本次变化方向：动作、地点、光线与姿态，每次生成都重新挑 */
    variation: PortraitVariation
    /** 外部取消信号（随出图请求一起中止） */
    signal?: AbortSignal
}

/** 单次场景描述生成结果：正文与用量一并回传，供服务层记账 */
export interface SceneGenerateResult {
    content: string
    usage: AiUsage | null
    meta: AiUsageMeta | null
}

/** 执行一次场景描述生成，返回模型原始正文与用量 */
export async function generateSceneWithAi(options: SceneGenerateOptions): Promise<SceneGenerateResult> {
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
            messages: buildSceneMessages(options.request, options.variation),
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
