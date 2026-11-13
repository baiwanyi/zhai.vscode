/**
 * 编辑区 AI 查询：把选中文本与问题交给共享 AI 通道，逐块回调给 webview。
 * 复用约定：通道与记账来自 aiLayer（全扩展共用一份 AiProvider 与 UsageRecorder），
 * 模型取当前选中模型，不新增模型选择入口；提示词与校对的拼装口径一致。
 * 关键约束：请求必须可中断（关闭弹窗即 abort），取消与失败都要记账；
 * 选中文本截断后再入提示词，日志只记长度不记全文。
 */
import type { AiChatMessage, AiProvider, AiUsage, AiUsageMeta } from '@modules/ai/provider'
import { getSelectedCodebuddyModel } from '@modules/ai/providers/codebuddyModels'
import type { UsageRecorder } from '@modules/ai/usageRecorder'
import { findCachedQuery, saveQuery } from './queryRepository'
import type Database from 'better-sqlite3'

/** 选中文本入提示词的上限：长段落只取前段，避免一次查询吃掉大量上下文 */
const MAX_QUOTE_CHARS = 2000

/** 问题长度上限：这里是输入框而非长文入口 */
const MAX_QUESTION_CHARS = 500

/** 输出上限：够写一段分析，不必给整章改写 */
const MAX_TOKENS = 1600

/** 默认问题：用户只点「查询」不写问题时仍能拿到有用结果 */
const DEFAULT_QUESTION = '请分析这段文字的写作问题，并给出具体的改进建议'

const SYSTEM_PROMPT =
    '你是中文小说写作助手。基于用户选中的段落回答问题，回答简洁具体，必要时给出改写示例。不要整段复述原文。'

export interface EditorQueryDeps {
    provider: AiProvider
    usageRecorder: UsageRecorder
    /** 缓存与历史所在库：懒求值，激活期不打开库；缺省时不做缓存，只回答 */
    db?: () => Database.Database
}

export interface EditorQueryInput {
    docPath: string
    quote: string
    question: string
    signal: AbortSignal
    /** 每个增量回调一次：调用方负责转成 webview 消息 */
    onDelta: (delta: string) => void
}

export interface EditorQueryOutcome {
    ok: boolean
    /** 失败或取消时可直接展示的原因 */
    reason?: string
    /** 已生成的内容：失败时可能非空，供界面保留部分结果 */
    content: string
    /** 命中缓存：内容直接返回，本次未调用模型、未计费 */
    fromCache?: boolean
}

/** 执行一次查询：先查通道就绪，再流式生成并记账 */
export async function runEditorQuery(deps: EditorQueryDeps, input: EditorQueryInput): Promise<EditorQueryOutcome> {
    const quote = input.quote.slice(0, MAX_QUOTE_CHARS).trim()
    const question = input.question.slice(0, MAX_QUESTION_CHARS).trim() || DEFAULT_QUESTION
    // 库按需打开：一条查询里缓存与写回共用同一个连接，避免重复求值
    const db = deps.db === undefined ? null : deps.db()
    // 缓存优先：同一段文字问同样的问题不再扣额度，且与文档无关——在另一篇里查到同一段
    // 也直接复用。命中时不校验通道就绪：结果已在本地，断网或未登录也能回看。
    if (db !== null) {
        const cached = findCachedQuery(db, quote, question)
        if (cached !== null) {
            return { ok: true, content: cached.answer, fromCache: true }
        }
    }
    const status = await deps.provider.checkReady()
    if (!status.ready) {
        return { ok: false, reason: status.reason ?? 'AI 通道未就绪', content: '' }
    }
    const messages: AiChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `选中文本：\n${quote}\n\n问题：${question}` },
    ]
    const prompt = messages.map((message) => message.content).join('\n\n')
    const model = getSelectedCodebuddyModel()
    const startedAt = Date.now()
    let content = ''
    let usage: AiUsage | null = null
    let meta: AiUsageMeta | null = null
    try {
        for await (const chunk of deps.provider.stream({
            model,
            maxTokens: MAX_TOKENS,
            messages,
            signal: input.signal,
        })) {
            if (chunk.content.length > 0) {
                content += chunk.content
                input.onDelta(chunk.content)
            }
            if (chunk.usage) {
                usage = chunk.usage
            }
            if (chunk.meta) {
                meta = chunk.meta
            }
        }
    } catch (error) {
        const isAborted = input.signal.aborted
        deps.usageRecorder.record({
            module: 'editor',
            model,
            usage,
            meta,
            prompt,
            startedAt,
            status: isAborted ? 'cancelled' : 'failed',
        })
        return {
            ok: false,
            reason: isAborted ? '查询已取消' : error instanceof Error ? error.message : '查询失败',
            content,
        }
    }
    deps.usageRecorder.record({ module: 'editor', model, usage, meta, prompt, startedAt, status: 'completed' })
    // 写历史失败不影响本次结果：用户已经拿到答案，历史只是附加价值
    if (db !== null && content.trim().length > 0) {
        try {
            saveQuery(db, { docPath: input.docPath, quote, question, answer: content, model })
        } catch {
            // 忽略：库不可写时不影响回答
        }
    }
    return { ok: true, content }
}
