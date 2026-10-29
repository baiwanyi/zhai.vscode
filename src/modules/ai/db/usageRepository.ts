/**
 * AI 用量仓储：ai_usage_logs 与 ai_prompts 两表的参数化读写，供记账、用量页读取与提示词查询共用。
 * 复用约定：全部 SQL 预编译绑定；列表按时间倒序取最近若干行，筛选、分页与汇总由调用方在内存中完成，
 * 库侧只负责带 LIMIT 的读取与积分回填所需的窗口查询，不把全表交给前端。
 * 关键约束：提示词正文只按请求 id 单条读取，列表查询不触碰该表。
 */
import type Database from 'better-sqlite3'

/** 写库一行：字段与记账入参一一对应，缺省值由调用方给定 */
export interface UsageLogInput {
    id: string
    conversationId: string | null
    module: string
    model: string
    requestId: string | null
    sdkMessageId: string | null
    promptTokens: number
    /** 本轮提示词字数：用于按真实 token 反算字符/token 比值，0 表示未记录 */
    promptChars: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
    credits: number | null
    costUsd: number
    cacheReadTokens: number
    cacheCreationTokens: number
    latencyMs: number
    status: string
    createdAt: string
}

/** 列表一行：只取展示需要的列 */
export interface UsageLogRecord {
    id: string
    requestId: string | null
    module: string
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    credits: number | null
    costUsd: number
    latencyMs: number
    status: string
    createdAt: string
}

/** 提示词行 */
export interface PromptRecord {
    content: string
    isTruncated: boolean
    createdAt: string
}

const USAGE_COLUMNS = `id, request_id AS requestId, module, model, prompt_tokens AS promptTokens,
    completion_tokens AS completionTokens, total_tokens AS totalTokens, credits, cost_usd AS costUsd,
    latency_ms AS latencyMs, status, created_at AS createdAt`

export function insertUsageLog(db: Database.Database, row: UsageLogInput): void {
    // project 是 v3 遗留的非空列：旧库无法改约束，新写入统一用模块键填充，保证两列口径一致
    db.prepare(
        `INSERT INTO ai_usage_logs (id, conversation_id, project, module, model, request_id, sdk_message_id,
            prompt_tokens, prompt_chars, completion_tokens, reasoning_tokens, total_tokens, credits, cost_usd,
            cache_read_tokens, cache_creation_tokens, latency_ms, status, created_at)
         VALUES (@id, @conversationId, @module, @module, @model, @requestId, @sdkMessageId, @promptTokens,
            @promptChars, @completionTokens, @reasoningTokens, @totalTokens, @credits, @costUsd, @cacheReadTokens,
            @cacheCreationTokens, @latencyMs, @status, @createdAt)`,
    ).run(row)
}

/** 字符/token 的默认比值：样本不足或数据异常时的兜底，也是本模块对外的唯一默认值 */
export const DEFAULT_CHARS_PER_TOKEN = 1.6
/** 参与校准的历史行数：越近的行越能代表当前模型与提示词构成 */
const CALIBRATION_SAMPLE_LIMIT = 200
/** 校准所需最小行数：样本太少时单轮波动会主导结果，直接回落默认值 */
const CALIBRATION_MIN_ROWS = 20
/** 合理区间：越界视为数据异常（跨模型混记、单位写错），不采纳 */
const MIN_CHARS_PER_TOKEN = 0.5
const MAX_CHARS_PER_TOKEN = 8

/**
 * 按模型统计「字符 / token」比值：只统计既记了提示词字数又报了 prompt tokens 的行。
 * 关键约束：用总量比值而非单行平均，避免短提示词把离群值放大；样本不足或越界一律回落默认值，
 * 校准结果只用于历史裁剪预算与降级估算，不参与计费，因此宁可保守也不追极端值。
 */
export function readCharsPerToken(db: Database.Database, model: string): number {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS rows, SUM(prompt_chars) AS chars, SUM(prompt_tokens) AS tokens FROM (
                 SELECT prompt_chars, prompt_tokens FROM ai_usage_logs
                 WHERE model = @model AND prompt_chars > 0 AND prompt_tokens > 0
                 ORDER BY created_at DESC LIMIT @limit
             )`,
        )
        .get({ model, limit: CALIBRATION_SAMPLE_LIMIT }) as
        | { rows: number; chars: number | null; tokens: number | null }
        | undefined
    if (row === undefined || row.rows < CALIBRATION_MIN_ROWS) {
        return DEFAULT_CHARS_PER_TOKEN
    }
    const chars = row.chars ?? 0
    const tokens = row.tokens ?? 0
    if (chars <= 0 || tokens <= 0) {
        return DEFAULT_CHARS_PER_TOKEN
    }
    const ratio = chars / tokens
    if (!Number.isFinite(ratio) || ratio < MIN_CHARS_PER_TOKEN || ratio > MAX_CHARS_PER_TOKEN) {
        return DEFAULT_CHARS_PER_TOKEN
    }
    return ratio
}

/** 参与对账的行：本地已有值与请求 id，供与 CLI 记录比对后修正 */
export interface CreditSyncRow {
    id: string
    requestId: string
    /** 本地已缓存的积分，null 表示尚未对账 */
    credits: number | null
}

/**
 * 列出参与对账的行：积分结论以 CodeBuddy 会话记录为准，本地只做缓存。
 * 只取最近 500 条，避免历史不可对账的行（旧版本地 UUID 请求 id）长期占据扫描窗口；
 * 已回填的行同样返回——CLI 侧积分是逐条累加的，工具调用晚落盘时首次只能拿到部分值，需要允许后续修正。
 */
export function listUsageForCreditSync(db: Database.Database): CreditSyncRow[] {
    return db
        .prepare(
            `SELECT id, request_id AS requestId, credits FROM ai_usage_logs
              WHERE request_id IS NOT NULL
              ORDER BY created_at DESC LIMIT 500`,
        )
        .all() as CreditSyncRow[]
}

/** 写入真实积分：以 CLI 记录为准，已对账但偏小的值一并修正，返回实际更新条数 */
export function updateUsageCredits(db: Database.Database, updates: Array<{ id: string; credits: number }>): number {
    if (updates.length === 0) {
        return 0
    }
    const statement = db.prepare('UPDATE ai_usage_logs SET credits = @credits WHERE id = @id')
    let changed = 0
    db.transaction((rows: Array<{ id: string; credits: number }>) => {
        for (const row of rows) {
            changed += statement.run(row).changes
        }
    })(updates)
    return changed
}

/**
 * 列出用量行：用量页以本地记账为明细主数据源，CLI 记录只补积分。
 * 上限由调用方给定，避免历史行无限增长后把整表读进内存。
 */
export function listAllUsageLogs(db: Database.Database, limit: number): UsageLogRecord[] {
    return db
        .prepare(`SELECT ${USAGE_COLUMNS} FROM ai_usage_logs ORDER BY created_at DESC LIMIT @limit`)
        .all({ limit }) as UsageLogRecord[]
}

/** 记录提示词：同一请求 id 重复写入时覆盖，便于重试场景复用同一轮次标识 */
export function upsertPrompt(
    db: Database.Database,
    row: { requestId: string; content: string; isTruncated: boolean; createdAt: string },
): void {
    db.prepare(
        `INSERT INTO ai_prompts (request_id, content, is_truncated, created_at)
         VALUES (@requestId, @content, @isTruncated, @createdAt)
         ON CONFLICT(request_id) DO UPDATE SET content = excluded.content,
            is_truncated = excluded.is_truncated, created_at = excluded.created_at`,
    ).run({ ...row, isTruncated: row.isTruncated ? 1 : 0 })
}

/** 按请求 id 读取提示词；不存在时返回 undefined（历史数据未记录提示词） */
export function getPrompt(db: Database.Database, requestId: string): PromptRecord | undefined {
    const row = db
        .prepare(
            'SELECT content, is_truncated AS isTruncated, created_at AS createdAt FROM ai_prompts WHERE request_id = ?',
        )
        .get(requestId) as { content: string; isTruncated: number; createdAt: string } | undefined
    if (row === undefined) {
        return undefined
    }
    // SQLite 无布尔类型：0/1 在这里转成布尔再出库，避免调用方拿到数字
    return { content: row.content, isTruncated: row.isTruncated === 1, createdAt: row.createdAt }
}

/** 清理保留期外的提示词，返回删除条数 */
export function prunePrompts(db: Database.Database, beforeIso: string): number {
    return db.prepare('DELETE FROM ai_prompts WHERE created_at < ?').run(beforeIso).changes
}
