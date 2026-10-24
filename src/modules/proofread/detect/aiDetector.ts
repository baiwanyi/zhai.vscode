/**
 * AI 特征检测：把朱雀分类结果映射为界面契约，并挑出最值得人工复核的可疑分段。
 * 复用约定：出网与响应收窄在 ./zhuqueClient，本层只做结果整形，偏移保持相对检查正文的口径。
 * 关键约束：只保留非人工分段并按置信度降序截断，避免界面被大量低置信分段淹没；
 * 分段序号优先取平台 order，缺失时按展示顺序回填，保证列表可读。
 */
import { classifyWithZhuque } from './zhuqueClient'
import type { ZhuqueClassifyResult } from './zhuqueClient'
import type { ProofreadAiDetectResult, ProofreadDetectSegment, ProofreadTarget } from '../../../shared/types/proofread'

/** 可疑分段展示上限 */
const MAX_SEGMENTS = 5

/** 把平台分类结果整形为界面契约 */
export function toDetectResult(target: ProofreadTarget, result: ZhuqueClassifyResult): ProofreadAiDetectResult {
    const segments: ProofreadDetectSegment[] = result.segments
        .filter((segment) => segment.label !== 0)
        .sort((left, right) => right.conf - left.conf)
        .slice(0, MAX_SEGMENTS)
        .map((segment, index) => ({
            paragraph: segment.order > 0 ? segment.order : index + 1,
            label: segment.label,
            conf: segment.conf,
            start: segment.start,
            end: segment.end,
            text: segment.text,
        }))
    return {
        path: target.path,
        version: target.version,
        humanRatio: result.humanRatio,
        aiRatio: result.aiRatio,
        suspectRatio: result.suspectRatio,
        confidence: result.confidence,
        ratioConfidence: result.ratioConfidence,
        segments,
        usedTokens: result.usedTokens,
        detectedAt: new Date().toISOString(),
    }
}

/** 对当前目标执行一次 AI 特征检测 */
export async function detectAiContent(options: {
    target: ProofreadTarget
    apiKey: string
    signal?: AbortSignal
}): Promise<ProofreadAiDetectResult> {
    const result = await classifyWithZhuque(options.target.text, options.apiKey, options.signal)
    return toDetectResult(options.target, result)
}
