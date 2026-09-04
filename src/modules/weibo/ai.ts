/**
 * AI 润色与 diff 采纳（发布前）。
 * LLM 客户端抽象，实际接入项目 DeepSeek 客户端（见开放问题 4）。
 */

import type { AIEditRequest, AIEditResult, DiffDecision, DiffHunk } from './types'

export interface LLMClient {
    complete(req: { model: string; system: string; prompt: string }): Promise<string>
}

let llmClient: LLMClient | null = null

export function setLLMClient(client: LLMClient): void {
    llmClient = client
}

export async function requestAIEdit(req: AIEditRequest): Promise<AIEditResult> {
    if (!llmClient) throw new Error('未配置 LLM 客户端：请先调用 setLLMClient')
    const edited = await llmClient.complete({
        model: req.model,
        system: '你是微博文案助手，仅返回改写后文本，不要解释',
        prompt: `${req.instruction}\n\n${req.text}`,
    })
    return { original: req.text, edited }
}

/** 计算逐行统一 diff（行级比对，生产可换成熟 diff 库） */
export function computeUnifiedDiff(original: string, edited: string): DiffHunk[] {
    const a = original.split('\n')
    const b = edited.split('\n')
    const hunks: DiffHunk[] = []
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max; i++) {
        const o = a[i]
        const e = b[i]
        if (o === e) {
            hunks.push({ type: 'context', content: o, lineNo: i + 1 })
        } else {
            if (o !== undefined) hunks.push({ type: 'remove', content: o })
            if (e !== undefined) hunks.push({ type: 'add', content: e })
        }
    }
    return hunks
}

/** 用户决策：采纳 edited / 拒绝保留 original */
export function applyDiffDecision(result: AIEditResult, decision: DiffDecision): string {
    return decision === 'accept' ? result.edited : result.original
}
