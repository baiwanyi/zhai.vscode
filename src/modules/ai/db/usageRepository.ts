/**
 * AI 用量仓储：ai_usage_logs 与 ai_prompts 两表的参数化读写，供记账、分页列表、汇总与提示词查询共用。
 * 复用约定：全部 SQL 预编译绑定；列表、计数与汇总共用同一 WHERE 片段，保证「共 N 条」与表格口径一致；
 * 分页在库侧完成（LIMIT/OFFSET），调用方只把页码换算成偏移量，不把全表交给前端。
 * 关键约束：提示词正文只按请求 id 单条读取，列表查询不触碰该表；
 * 模块筛选以 `@module IS NULL OR module = @module` 表达，NULL 即不筛选，不接受拼接片段。
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

/** 列表筛选：since 为 null 表示不限时间 */
export interface UsageLogFilter {
    module: string | null
    since: string | null
    limit: number
    offset: number
}

/** 汇总结果：credits 为 null 表示当前范围内没有任何一条可估算积分 */
export interface UsageLogSummaryRow {
    requests: number
    credits: number | null
    costUsd: number
    tokens: number
}

/** 提示词行 */
export interface PromptRecord {
    content: string
    isTruncated: boolean
    createdAt: string
}

const USAGE_WHERE = `WHERE (@module IS NULL OR module = @module) AND (@since IS NULL OR created_at >= @since)`

const USAGE_COLUMNS = `id, request_id AS requestId, module, model, prompt_tokens AS promptTokens,
    completion_tokens AS completionTokens, total_tokens AS totalTokens, credits, cost_usd AS costUsd,
    latency_ms AS latencyMs, status, created_at AS createdAt`

export function insertUsageLog(db: Database.Database, row: UsageLogInput): void {
    // project 是 v3 遗留的非空列：旧库无法改约束，新写入统一用模块键填充，保证两列口径一致
    db.prepare(
        `INSERT INTO ai_usage_logs (id, conversation_id, project, module, model, request_id, sdk_message_id,
            prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, credits, cost_usd, cache_read_tokens,
            cache_creation_tokens, latency_ms, status, created_at)
         VALUES (@id, @conversationId, @module, @module, @model, @requestId, @sdkMessageId, @promptTokens,
            @completionTokens, @reasoningTokens, @totalTokens, @credits, @costUsd, @cacheReadTokens,
            @cacheCreationTokens, @latencyMs, @status, @createdAt)`,
    ).run(row)
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

/** 查询一页用量：按时间倒序，limit/offset 由调用方夹紧 */
export function listUsageLogs(db: Database.Database, filter: UsageLogFilter): UsageLogRecord[] {
    return db
        .prepare(
            `SELECT ${USAGE_COLUMNS} FROM ai_usage_logs ${USAGE_WHERE}
              ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
        )
        .all(filter) as UsageLogRecord[]
}

/** 统计满足筛选条件的总条数（分页用） */
export function countUsageLogs(db: Database.Database, filter: Omit<UsageLogFilter, 'limit' | 'offset'>): number {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ai_usage_logs ${USAGE_WHERE}`).get(filter) as
        { total: number } | undefined
    return row?.total ?? 0
}

/** 汇总当前筛选范围：积分全为 NULL 时返回 null，避免把「未知」显示成 0 */
export function sumUsageLogs(
    db: Database.Database,
    filter: Omit<UsageLogFilter, 'limit' | 'offset'>,
): UsageLogSummaryRow {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS requests,
                    CASE WHEN COUNT(credits) = 0 THEN NULL ELSE SUM(credits) END AS credits,
                    COALESCE(SUM(cost_usd), 0) AS costUsd,
                    COALESCE(SUM(total_tokens), 0) AS tokens
               FROM ai_usage_logs ${USAGE_WHERE}`,
        )
        .get(filter) as UsageLogSummaryRow | undefined
    return row ?? { requests: 0, credits: null, costUsd: 0, tokens: 0 }
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
