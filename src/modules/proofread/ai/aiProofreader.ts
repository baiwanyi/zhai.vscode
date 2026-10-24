/**
 * AI 校对执行器：按批次串行调用 AI 通道，逐批解析并聚合问题条目，失败批次只计数不阻断整体。
 * 复用约定：批次切分与解析在 ./proofreadPrompt，通道由服务层注入，本层不读凭证也不落库。
 * 关键约束：单批超时与外部取消都走 AbortController；外部取消必须向上抛出，
 * 让服务层把「用户取消」与「单批失败」分开表达；用量按批累加，供记账与配额展示；
 * 整体时间预算耗尽时不再提交新批次并计入 skippedBatches——长文档宁可返回部分结果，
 * 也不能让调用方等到请求超时后拿不到任何结论（前端等待上限必须大于该预算）。
 */
import { buildProofreadMessages, parseProofreadResponse, splitProofreadBatches } from './proofreadPrompt'
import type { ProofreadIssue, ProofreadTarget } from '../../../shared/types/proofread'
import type { AiProvider, AiUsage, AiUsageMeta } from '../../ai/provider'
import { logger } from '../../common/logger'

/** 单批生成超时：一个批次通常 2–8 秒，留足余量 */
const BATCH_TIMEOUT_MS = 45_000

/** 整体时间预算：超出后不再提交新批次，改回已完成批次的结果 */
const TOTAL_BUDGET_MS = 240_000

/** 剩余预算低于该值即不再开新批：半个单批时间的等待没有意义 */
const MIN_BATCH_BUDGET_MS = 8_000

/** 单批输出上限：一批最多报若干条，1200 token 足够 */
const MAX_TOKENS_PER_BATCH = 1200

export interface ProofreadAiOptions {
    provider: AiProvider
    model: string
    target: ProofreadTarget
    batchChars: number
    signal: AbortSignal
    /** 整体时间预算：默认 TOTAL_BUDGET_MS，单测可注入极小值验证跳过逻辑 */
    budgetMs?: number
    /** 每完成一批回调一次（含失败批），用于界面进度 */
    onProgress?: (completed: number, total: number) => void
}

export interface ProofreadAiOutcome {
    issues: ProofreadIssue[]
    batches: number
    failedBatches: number
    /** 预算耗尽而未提交的批次数：与 failedBatches 分开，界面据此提示结果不完整 */
    skippedBatches: number
    /** 按批累加后的用量；一批未成功时为 null */
    usage: AiUsage | null
    meta: AiUsageMeta | null
    /** 提示词摘要：只取首批，多批在末尾标注总数 */
    prompt: string
}

/** 累加用量：任一批缺少用量时按 0 计入，不伪造 */
function addUsage(total: AiUsage | null, chunk: AiUsage): AiUsage {
    if (total === null) {
        return { ...chunk }
    }
    return {
        promptTokens: total.promptTokens + chunk.promptTokens,
        completionTokens: total.completionTokens + chunk.completionTokens,
        reasoningTokens: total.reasoningTokens + chunk.reasoningTokens,
        totalTokens: total.totalTokens + chunk.totalTokens,
    }
}

/** 执行一次 AI 校对，返回聚合后的问题条目与用量 */
export async function runAiProofread(options: ProofreadAiOptions): Promise<ProofreadAiOutcome> {
    const batches = splitProofreadBatches(options.target.text, options.batchChars)
    const empty: ProofreadAiOutcome = {
        issues: [],
        batches: 0,
        failedBatches: 0,
        skippedBatches: 0,
        usage: null,
        meta: null,
        prompt: '',
    }
    if (batches.length === 0) {
        return empty
    }
    const budgetMs = options.budgetMs ?? TOTAL_BUDGET_MS
    const startedAt = Date.now()
    const issues: ProofreadIssue[] = []
    let usage: AiUsage | null = null
    let meta: AiUsageMeta | null = null
    let prompt = ''
    let failedBatches = 0
    let skippedBatches = 0
    for (const [index, batch] of batches.entries()) {
        if (options.signal.aborted) {
            throw new Error('AI 校对已取消')
        }
        // 预算不足就停在这里：剩余批次计入 skipped，已得结果照常返回
        const remaining = budgetMs - (Date.now() - startedAt)
        if (remaining <= MIN_BATCH_BUDGET_MS) {
            skippedBatches = batches.length - index
            break
        }
        const messages = buildProofreadMessages(batch, index + 1, batches.length)
        if (prompt.length === 0) {
            prompt = messages.map((message) => message.content).join('\n\n')
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.min(BATCH_TIMEOUT_MS, remaining))
        const forwardAbort = (): void => controller.abort()
        options.signal.addEventListener('abort', forwardAbort, { once: true })
        try {
            let content = ''
            for await (const chunk of options.provider.stream({
                model: options.model,
                maxTokens: MAX_TOKENS_PER_BATCH,
                messages,
                signal: controller.signal,
            })) {
                content += chunk.content
                if (chunk.usage) {
                    usage = addUsage(usage, chunk.usage)
                }
                if (chunk.meta) {
                    meta = chunk.meta
                }
            }
            const parsed = parseProofreadResponse(content, batch, options.target.text)
            issues.push(...parsed.issues)
        } catch (error) {
            if (options.signal.aborted) {
                throw error instanceof Error ? error : new Error('AI 校对已取消')
            }
            failedBatches += 1
            logger.warn(
                `AI 校对第 ${String(index + 1)}/${String(batches.length)} 批失败：${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        } finally {
            clearTimeout(timer)
            options.signal.removeEventListener('abort', forwardAbort)
        }
        options.onProgress?.(index + 1, batches.length)
    }
    return {
        issues,
        batches: batches.length,
        failedBatches,
        skippedBatches,
        usage,
        meta,
        prompt: batches.length > 1 ? `${prompt}\n\n（共 ${String(batches.length)} 批）` : prompt,
    }
}
