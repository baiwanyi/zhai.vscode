/**
 * AI 会话仓储：conversations / messages / ai_usage_logs 三表的参数化读写。
 * 安全约束：全部 SQL 使用预编译参数绑定，禁止字符串拼接；批量写入统一走事务。
 */
import type Database from 'better-sqlite3'

/** conversations 表一行 */
export interface ConversationRow {
    id: string
    title: string
    mode: string
    filePath: string | null
    model: string
    createdAt: string
    updatedAt: string
}

/** messages 表一行 */
export interface MessageRow {
    id: string
    conversationId: string
    role: string
    content: string
    reasoning: string | null
    status: string
    finishReason: string | null
    error: string | null
    createdAt: string
}

/** 消息可变字段（流式过程中多次更新） */
export interface MessagePatch {
    content: string
    reasoning: string | null
    status: string
    finishReason: string | null
    error: string | null
}

/** ai_usage_logs 表一行 */
export interface UsageLogRow {
    id: string
    conversationId: string | null
    project: string
    model: string
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
    estimatedCost: number
    latencyMs: number
    createdAt: string
}

const CONVERSATION_COLUMNS = `id, title, mode, file_path AS filePath, model,
    created_at AS createdAt, updated_at AS updatedAt`

const MESSAGE_COLUMNS = `id, conversation_id AS conversationId, role, content, reasoning, status,
    finish_reason AS finishReason, error, created_at AS createdAt`

export function insertConversation(db: Database.Database, row: ConversationRow): void {
    db.prepare(
        `INSERT INTO conversations (id, title, mode, file_path, model, created_at, updated_at)
         VALUES (@id, @title, @mode, @filePath, @model, @createdAt, @updatedAt)`,
    ).run(row)
}

export function getConversation(db: Database.Database, id: string): ConversationRow | undefined {
    return db.prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`).get(id) as
        | ConversationRow
        | undefined
}

/** 取最近活跃的会话（视图恢复时复用它） */
export function getLatestConversation(db: Database.Database): ConversationRow | undefined {
    return db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations ORDER BY updated_at DESC LIMIT 1`)
        .get() as ConversationRow | undefined
}

export function updateConversationTitle(db: Database.Database, id: string, title: string): void {
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
}

export function touchConversation(db: Database.Database, id: string, updatedAt: string): void {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, id)
}

export function deleteConversation(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function insertMessage(db: Database.Database, row: MessageRow): void {
    db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, reasoning, status, finish_reason, error, created_at)
         VALUES (@id, @conversationId, @role, @content, @reasoning, @status, @finishReason, @error, @createdAt)`,
    ).run(row)
}

export function updateMessage(db: Database.Database, id: string, patch: MessagePatch): void {
    db.prepare(
        `UPDATE messages
            SET content = @content, reasoning = @reasoning, status = @status,
                finish_reason = @finishReason, error = @error
          WHERE id = @id`,
    ).run({ ...patch, id })
}

/** 按会话读取消息（升序，供前端直接渲染） */
export function listMessages(db: Database.Database, conversationId: string): MessageRow[] {
    return db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
        .all(conversationId) as MessageRow[]
}

export function insertUsageLog(db: Database.Database, row: UsageLogRow): void {
    db.prepare(
        `INSERT INTO ai_usage_logs (id, conversation_id, project, model, prompt_tokens, completion_tokens,
            reasoning_tokens, total_tokens, estimated_cost, latency_ms, created_at)
         VALUES (@id, @conversationId, @project, @model, @promptTokens, @completionTokens,
            @reasoningTokens, @totalTokens, @estimatedCost, @latencyMs, @createdAt)`,
    ).run(row)
}

/** 统计某个时间点之后的累计 token 用量（预算护栏，A17） */
export function sumTokensSince(db: Database.Database, sinceIso: string): number {
    const row = db
        .prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM ai_usage_logs WHERE created_at >= ?')
        .get(sinceIso) as { total: number } | undefined
    return row?.total ?? 0
}
