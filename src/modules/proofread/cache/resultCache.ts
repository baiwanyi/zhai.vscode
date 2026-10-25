/**
 * 校对结果缓存：把最近一次校对结果与 AI 特征检测结果落到 globalState，供再次打开校对页直接还原。
 * 复用约定：字段结构取自 shared/types/proofread，读入时逐字段收窄，签名比对只认 path / kind / offsetBase / mtime / chars。
 * 关键约束：缓存是持久化数据，结构不符即视为无缓存，不能把半份数据交给界面；
 * 正文一旦改动（修改时间或字符数变化）签名即不匹配，宁可重跑也不能把旧偏移标到新正文上；
 * 写入失败只记日志，不得影响校对本身的返回。
 */
import { logger } from '@modules/common/logger'
import type {
    ProofreadAiDetectResult,
    ProofreadAiResult,
    ProofreadCache,
    ProofreadCachedTarget,
    ProofreadDetectCache,
    ProofreadDetectSegment,
    ProofreadIssue,
    ProofreadLocalResult,
    ProofreadSeverity,
    ProofreadTarget,
} from '@shared/types/proofread'
import { isProofreadCategory } from '@shared/types/proofread'

/**
 * 缓存存储接口：只依赖 get / update 两个方法。
 * 宿主传 vscode.Memento，单测可直接注入内存实现，无需伪造整个 Memento。
 */
export interface CacheState {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): Thenable<void>
}

/** 校对结果缓存键 */
const RESULT_CACHE_KEY = 'proofread.resultCache'

/** 检测结果缓存键 */
const DETECT_CACHE_KEY = 'proofread.detectCache'

/** 单份缓存保留的问题条数上限：超出部分不落盘，避免全局状态被异常结果撑大 */
const MAX_CACHED_ISSUES = 2000

/** 非负整数判定：偏移、序号、计数都走这一套 */
function isNonNegativeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 数值兜底：读数不是有限数时按 fallback 处理，避免 NaN 进入界面 */
function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 目标转缓存签名：剔除正文，保留展示与偏移换算所需字段 */
export function toCachedTarget(target: ProofreadTarget): ProofreadCachedTarget {
    return {
        kind: target.kind,
        path: target.path,
        title: target.title,
        wordCount: target.wordCount,
        offsetBase: target.offsetBase,
        version: target.version,
        mtime: target.mtime,
        truncated: target.truncated,
        chars: target.text.length,
    }
}

/** 签名比对：路径、范围、修改时间与正文字符数全部一致才算同一份结果 */
export function isSameTarget(cached: ProofreadCachedTarget, target: ProofreadTarget): boolean {
    return (
        cached.path === target.path &&
        cached.kind === target.kind &&
        cached.offsetBase === target.offsetBase &&
        cached.mtime === target.mtime &&
        cached.chars === target.text.length
    )
}

/** 读取校对结果缓存：结构不合法时返回 null */
export function readProofreadCache(state: CacheState): ProofreadCache | null {
    return parseCache(state.get<unknown>(RESULT_CACHE_KEY))
}

/** 写入校对结果缓存：写失败只记日志 */
export async function writeProofreadCache(state: CacheState, cache: ProofreadCache): Promise<void> {
    await updateState(state, RESULT_CACHE_KEY, cache)
}

/** 读取检测结果缓存：结构不合法时返回 null */
export function readDetectCache(state: CacheState): ProofreadDetectCache | null {
    return parseDetectCache(state.get<unknown>(DETECT_CACHE_KEY))
}

/** 写入检测结果缓存：写失败只记日志 */
export async function writeDetectCache(state: CacheState, cache: ProofreadDetectCache): Promise<void> {
    await updateState(state, DETECT_CACHE_KEY, cache)
}

/** 落盘：异常只记日志，缓存属于旁路能力 */
async function updateState(state: CacheState, key: string, value: unknown): Promise<void> {
    try {
        await state.update(key, value)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`校对缓存写入失败：${key}（${reason}）`)
    }
}

/** 解析缓存签名 */
function parseCachedTarget(value: unknown): ProofreadCachedTarget | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const kind = row.kind
    const path = row.path
    const title = row.title
    const mtime = row.mtime
    if (kind !== 'document' && kind !== 'selection') {
        return null
    }
    if (typeof path !== 'string' || path.length === 0 || typeof title !== 'string' || typeof mtime !== 'string') {
        return null
    }
    const wordCount = row.wordCount
    const offsetBase = row.offsetBase
    const version = row.version
    const chars = row.chars
    if (
        !isNonNegativeInt(wordCount) ||
        !isNonNegativeInt(offsetBase) ||
        !isNonNegativeInt(version) ||
        !isNonNegativeInt(chars)
    ) {
        return null
    }
    return { kind, path, title, wordCount, offsetBase, version, mtime, truncated: row.truncated === true, chars }
}

/** 严重度收窄 */
function readSeverity(value: unknown): ProofreadSeverity | null {
    if (value === 'low' || value === 'medium' || value === 'high') {
        return value
    }
    return null
}

/** 单条问题收窄：任一字段非法即整条作废 */
function parseIssue(value: unknown): ProofreadIssue | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const category = row.category
    const severity = readSeverity(row.severity)
    const id = row.id
    const quote = row.quote
    const replacement = row.replacement
    const reason = row.reason
    const start = row.start
    const end = row.end
    const paragraph = row.paragraph
    if (!isProofreadCategory(category) || severity === null) {
        return null
    }
    if (typeof id !== 'string' || typeof quote !== 'string' || typeof reason !== 'string') {
        return null
    }
    if (replacement !== null && typeof replacement !== 'string') {
        return null
    }
    if (!isNonNegativeInt(start) || !isNonNegativeInt(end) || !isNonNegativeInt(paragraph)) {
        return null
    }
    return {
        id,
        category,
        severity,
        quote,
        start,
        end,
        replacement,
        reason,
        source: row.source === 'ai' ? 'ai' : 'local',
        paragraph,
    }
}

/** 问题列表收窄：一条不合法即整份作废，避免半份缓存造成漏报 */
function parseIssues(value: unknown): ProofreadIssue[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const issues: ProofreadIssue[] = []
    for (const item of value.slice(0, MAX_CACHED_ISSUES)) {
        const issue = parseIssue(item)
        if (issue === null) {
            return null
        }
        issues.push(issue)
    }
    return issues
}

/** 本地结果收窄 */
function parseLocalResult(value: unknown): ProofreadLocalResult | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const issues = parseIssues(row.issues)
    if (issues === null) {
        return null
    }
    return {
        issues,
        elapsedMs: readNumber(row.elapsedMs, 0),
        suppressed: isNonNegativeInt(row.suppressed) ? row.suppressed : 0,
        lexiconEntries: isNonNegativeInt(row.lexiconEntries) ? row.lexiconEntries : 0,
    }
}

/** AI 结果收窄：缺失时返回 null，与「未跑」等价 */
function parseAiResult(value: unknown): ProofreadAiResult | null {
    if (value === null || value === undefined) {
        return null
    }
    if (typeof value !== 'object') {
        return null
    }
    const row = value as Record<string, unknown>
    const issues = parseIssues(row.issues)
    const path = row.path
    const mtime = row.mtime
    if (issues === null || typeof path !== 'string' || typeof mtime !== 'string') {
        return null
    }
    return {
        issues,
        path,
        version: isNonNegativeInt(row.version) ? row.version : 0,
        mtime,
        batches: isNonNegativeInt(row.batches) ? row.batches : 0,
        failedBatches: isNonNegativeInt(row.failedBatches) ? row.failedBatches : 0,
        // 旧缓存没有该字段，按 0 处理（当时不存在预算跳过）
        skippedBatches: isNonNegativeInt(row.skippedBatches) ? row.skippedBatches : 0,
        usageTokens: isNonNegativeInt(row.usageTokens) ? row.usageTokens : 0,
    }
}

/** 可疑分段收窄 */
function parseDetectSegment(value: unknown): ProofreadDetectSegment | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const label = row.label
    const text = row.text
    const paragraph = row.paragraph
    const start = row.start
    const end = row.end
    if (label !== 0 && label !== 1 && label !== 2) {
        return null
    }
    if (
        typeof text !== 'string' ||
        !isNonNegativeInt(paragraph) ||
        !isNonNegativeInt(start) ||
        !isNonNegativeInt(end)
    ) {
        return null
    }
    return { paragraph, label, conf: readNumber(row.conf, 0), start, end, text }
}

/** 检测结果收窄 */
function parseDetectResult(value: unknown): ProofreadAiDetectResult | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const path = row.path
    const detectedAt = row.detectedAt
    if (typeof path !== 'string' || typeof detectedAt !== 'string' || !Array.isArray(row.segments)) {
        return null
    }
    const segments: ProofreadDetectSegment[] = []
    for (const item of row.segments) {
        const segment = parseDetectSegment(item)
        if (segment === null) {
            return null
        }
        segments.push(segment)
    }
    return {
        path,
        version: isNonNegativeInt(row.version) ? row.version : 0,
        humanRatio: readNumber(row.humanRatio, 0),
        aiRatio: readNumber(row.aiRatio, 0),
        suspectRatio: readNumber(row.suspectRatio, 0),
        confidence: readNumber(row.confidence, 0),
        ratioConfidence: readNumber(row.ratioConfidence, 0),
        segments,
        usedTokens: isNonNegativeInt(row.usedTokens) ? row.usedTokens : 0,
        detectedAt,
    }
}

/** 校对缓存收窄 */
function parseCache(value: unknown): ProofreadCache | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const target = parseCachedTarget(row.target)
    const local = parseLocalResult(row.local)
    const savedAt = row.savedAt
    if (target === null || local === null || typeof savedAt !== 'string') {
        return null
    }
    return { savedAt, target, local, ai: parseAiResult(row.ai) }
}

/** 检测缓存收窄 */
function parseDetectCache(value: unknown): ProofreadDetectCache | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const row = value as Record<string, unknown>
    const target = parseCachedTarget(row.target)
    const result = parseDetectResult(row.result)
    const savedAt = row.savedAt
    if (target === null || result === null || typeof savedAt !== 'string') {
        return null
    }
    return { savedAt, target, result }
}
