/**
 * AI 校对提示词与结果校验：把正文切成批次、构造单批消息，并把模型输出收敛为可定位的问题条目。
 * 复用约定：消息结构复用 ai/provider 的 AiChatMessage；段落号换算复用 ../textPosition。
 * 关键约束：模型只允许返回原文片段（quote），偏移一律由宿主在该批原文中 indexOf 回查，
 * 回查不到、长度越界、类别非法的条目直接丢弃并计入 dropped，绝不采信模型给出的位置；
 * 同批次内同一区间只保留一条，避免模型重复报告。
 */
import type { ProofreadIssue } from '../../../shared/types/proofread'
import type { AiChatMessage as ChatMessage } from '../../ai/provider'
import { buildLineStarts, toParagraph } from '../textPosition'

/** 单个检查批次：文本与其在全文中的起始偏移 */
export interface ProofreadBatch {
    text: string
    start: number
}

/** 批次内原文片段的最小长度：过短的片段无法唯一定位 */
const MIN_QUOTE_LENGTH = 4

/** 批次内原文片段的最大长度 */
const MAX_QUOTE_LENGTH = 200

/** 建议文本长度上限 */
const MAX_SUGGESTION_LENGTH = 120

/** 理由文本长度上限 */
const MAX_REASON_LENGTH = 80

/** 单批最少字符数：配置过小时兜底，避免切成大量微批 */
const MIN_BATCH_CHARS = 200

/** 系统提示：只报确定性问题，输出严格 JSON */
const SYSTEM_PROMPT = `你是中文小说的校对助手。任务是找出病句与内容风险段落，不改写正文、不评价文风。
严格输出 JSON：{"items":[{"kind":"sentence","quote":"原文片段","suggestion":"最小改法","reason":"问题说明"}]}
规则：
1. quote 必须是原文中逐字存在的连续片段（4-200 字），不得改写、不得拼接、不得省略中间内容。
2. kind=sentence：语法错误、成分残缺、搭配不当、指代不明、语序混乱、明显冗余。
3. kind=risk：可能触发平台内容审核的表述，包括影射现实人物或机构、涉未成年人的不当描写、极端暴力血腥细节、违法犯罪操作细节。
4. suggestion 给最小改法（不超过 120 字），reason 说明问题（不超过 80 字）。
5. 没有问题时输出 {"items":[]}；不确定的不要报。
6. 只输出 JSON，不要解释。`

/** 解析结果：成品条目与被丢弃条数 */
export interface ProofreadParseResult {
    issues: ProofreadIssue[]
    dropped: number
}

/** 把正文切成批次：优先在换行处断开，纯空白片段不送检但保留偏移 */
export function splitProofreadBatches(text: string, maxChars: number): ProofreadBatch[] {
    const limit = Math.max(MIN_BATCH_CHARS, Math.floor(maxChars))
    const batches: ProofreadBatch[] = []
    let start = 0
    while (start < text.length) {
        let end = Math.min(start + limit, text.length)
        if (end < text.length) {
            const newline = text.lastIndexOf('\n', end)
            if (newline > start + limit / 2) {
                end = newline + 1
            }
        }
        const slice = text.slice(start, end)
        if (slice.trim().length > 0) {
            batches.push({ text: slice, start })
        }
        start = end
    }
    return batches
}

/** 构造单批校对消息：带上批次序号，便于模型与排查对齐 */
export function buildProofreadMessages(batch: ProofreadBatch, index: number, total: number): ChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `第 ${String(index)}/${String(total)} 批正文：\n${batch.text}` },
    ]
}

/**
 * 清理模型输出：去掉代码围栏与前后解释，截取最外层 JSON。
 * 关键约束：先出现的是 `[` 还是 `{` 决定截取哪一对括号——裸数组里的每条对象也有花括号，
 * 直接优先找 `{` 会把整个数组截成单个对象，导致结果被整体丢弃。
 */
function extractJsonText(content: string): string {
    const cleaned = content
        .replace(/```[a-zA-Z]*/g, '')
        .replace(/```/g, '')
        .trim()
    const objectStart = cleaned.indexOf('{')
    const arrayStart = cleaned.indexOf('[')
    const isArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
    const start = isArray ? arrayStart : objectStart
    const end = isArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) {
        return ''
    }
    return cleaned.slice(start, end + 1)
}

/** 取出条目数组：兼容 {"items":[...]} 与裸数组两种输出 */
function extractItems(content: string): unknown[] {
    const jsonText = extractJsonText(content)
    if (jsonText.length === 0) {
        return []
    }
    try {
        const parsed: unknown = JSON.parse(jsonText)
        if (Array.isArray(parsed)) {
            return parsed
        }
        if (typeof parsed === 'object' && parsed !== null) {
            const items = (parsed as { items?: unknown }).items
            if (Array.isArray(items)) {
                return items
            }
        }
        return []
    } catch {
        return []
    }
}

/** 文本字段收窄：去控制字符、去首尾空白并限长 */
function readText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value
        .replace(/[\p{Cc}]/gu, '')
        .trim()
        .slice(0, maxLength)
}

/** 组装展示用理由：模型未给理由时回落固定文案，给了建议则附在理由之后 */
function buildReason(reasonText: string, suggestion: string, fallback: string): string {
    if (reasonText.length === 0) {
        return fallback
    }
    return suggestion.length === 0 ? reasonText : `${reasonText}（建议：${suggestion}）`
}

/** 解析单批输出：偏移换算与逐项校验都在此完成 */
export function parseProofreadResponse(content: string, batch: ProofreadBatch, fullText: string): ProofreadParseResult {
    const items = extractItems(content)
    const lineStarts = buildLineStarts(fullText)
    const issues: ProofreadIssue[] = []
    const seen = new Set<string>()
    let dropped = 0
    for (const item of items) {
        if (typeof item !== 'object' || item === null) {
            dropped += 1
            continue
        }
        const source = item as { kind?: unknown; quote?: unknown; suggestion?: unknown; reason?: unknown }
        const kind = source.kind === 'risk' ? 'risk' : source.kind === 'sentence' ? 'sentence' : null
        const quote = readText(source.quote, MAX_QUOTE_LENGTH)
        if (kind === null || quote.length < MIN_QUOTE_LENGTH) {
            dropped += 1
            continue
        }
        const localIndex = batch.text.indexOf(quote)
        if (localIndex < 0) {
            dropped += 1
            continue
        }
        const start = batch.start + localIndex
        const end = start + quote.length
        const key = `${String(start)}:${String(end)}`
        if (seen.has(key)) {
            dropped += 1
            continue
        }
        seen.add(key)
        const suggestion = readText(source.suggestion, MAX_SUGGESTION_LENGTH)
        const reasonText = readText(source.reason, MAX_REASON_LENGTH)
        const fallbackReason = kind === 'risk' ? '可能触发平台内容审核，请人工确认' : '疑似病句，请人工确认'
        issues.push({
            id: `ai-${kind}-${String(start)}-${String(end)}`,
            category: kind,
            severity: kind === 'risk' ? 'high' : 'medium',
            quote,
            start,
            end,
            replacement: null,
            reason: buildReason(reasonText, suggestion, fallbackReason),
            source: 'ai',
            paragraph: toParagraph(lineStarts, start),
        })
    }
    return { issues, dropped }
}
