/**
 * AI 会话仓储：conversations / messages 两表的参数化读写，以及用量表的预算汇总。
 * 安全约束：全部 SQL 使用预编译参数绑定，禁止字符串拼接；批量写入统一走事务。
 * 作用域约定：会话按 project_dir 隔离，取最近会话与历史列表都必须带作用域，避免跨作品串历史；
 * 作用域比较统一用 `IS ?`（NULL 安全），作品对话与非作品通用对话各成一份。
 * 关键约束：用量写入与分页查询在 usageRepository，本文件只保留预算护栏需要的累计 token 统计。
 */
import type Database from 'better-sqlite3'

/** conversations 表一行 */
export interface ConversationRow {
    id: string
    title: string
    mode: string
    filePath: string | null
    /** 会话所属作用域（作品目录，形如 press/{作品名}）；NULL 表示不属于任何作品的通用对话 */
    projectDir: string | null
    model: string
    /** 创建会话时使用的 AI 通道，切换通道后旧会话号不再复用 */
    provider: string
    /** 通道侧会话号：CodeBuddy 用于 resume 续接，其它通道为 null */
    sdkSessionId: string | null
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
    /** 发送时携带的上下文引用（JSON 数组，含绝对路径，仅宿主使用） */
    refs: string
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

const CONVERSATION_COLUMNS = `id, title, mode, file_path AS filePath, project_dir AS projectDir, model, provider,
    sdk_session_id AS sdkSessionId, created_at AS createdAt, updated_at AS updatedAt`

const MESSAGE_COLUMNS = `id, conversation_id AS conversationId, role, content, reasoning, status,
    finish_reason AS finishReason, refs, error, created_at AS createdAt`

export function insertConversation(db: Database.Database, row: ConversationRow): void {
    db.prepare(
        `INSERT INTO conversations (id, title, mode, file_path, project_dir, model, provider, sdk_session_id,
            created_at, updated_at)
         VALUES (@id, @title, @mode, @filePath, @projectDir, @model, @provider, @sdkSessionId, @createdAt, @updatedAt)`,
    ).run(row)
}

/** 记录通道侧会话号：首轮生成拿到 session_id 后回写，供后续 resume 续接 */
export function updateConversationSession(
    db: Database.Database,
    id: string,
    provider: string,
    sdkSessionId: string | null,
): void {
    db.prepare('UPDATE conversations SET provider = ?, sdk_session_id = ? WHERE id = ?').run(provider, sdkSessionId, id)
}

export function getConversation(db: Database.Database, id: string): ConversationRow | undefined {
    return db.prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`).get(id) as
        ConversationRow | undefined
}

/** 取指定作用域最近活跃的会话（视图恢复时复用它）；作用域为 null 时取通用对话 */
export function getLatestConversation(db: Database.Database, projectDir: string | null): ConversationRow | undefined {
    return db
        .prepare(
            `SELECT ${CONVERSATION_COLUMNS} FROM conversations
              WHERE project_dir IS ? ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(projectDir) as ConversationRow | undefined
}

/** 按最后活跃时间倒序列出指定作用域的会话（历史对话浮层用，条数由调用方限制） */
export function listConversations(db: Database.Database, limit: number, projectDir: string | null): ConversationRow[] {
    return db
        .prepare(
            `SELECT ${CONVERSATION_COLUMNS} FROM conversations
              WHERE project_dir IS ? ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(projectDir, limit) as ConversationRow[]
}

export function updateConversationTitle(db: Database.Database, id: string, title: string): void {
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
}

/** 更新会话模式：对话 / 写作，随会话持久化，重启窗口后恢复 */
export function updateConversationMode(db: Database.Database, id: string, mode: string): void {
    db.prepare('UPDATE conversations SET mode = ? WHERE id = ?').run(mode, id)
}

export function touchConversation(db: Database.Database, id: string, updatedAt: string): void {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, id)
}

export function deleteConversation(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function insertMessage(db: Database.Database, row: MessageRow): void {
    db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, reasoning, status, finish_reason, refs, error, created_at)
         VALUES (@id, @conversationId, @role, @content, @reasoning, @status, @finishReason, @refs, @error, @createdAt)`,
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

/** 统计某个时间点之后的累计 token 用量（预算护栏，A17） */
export function sumTokensSince(db: Database.Database, sinceIso: string): number {
    const row = db
        .prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM ai_usage_logs WHERE created_at >= ?')
        .get(sinceIso) as { total: number } | undefined
    return row?.total ?? 0
}
