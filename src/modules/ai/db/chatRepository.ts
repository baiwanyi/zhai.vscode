/**
 * AI 会话仓储：conversations / messages 两表的参数化读写，以及用量表的预算汇总。
 * 安全约束：全部 SQL 使用预编译参数绑定，禁止字符串拼接；批量写入统一走事务。
 * 作用域约定：会话按 project_dir 隔离，取最近会话与历史列表都必须带作用域，避免跨作品串历史；
 * 作用域比较统一用 `IS ?`（NULL 安全），作品对话与非作品通用对话各成一份。
 * 关键约束：用量写入与分页查询在 usageRepository，本文件只保留预算护栏需要的累计 token 统计；
 * 上下文占用写库时不得顺带刷新 updated_at，否则每次生成都会把会话顶到历史列表最前。
 */
import type Database from 'better-sqlite3'

/** conversations 表一行 */
export interface ConversationRow {
    id: string
    title: string
    /** 模式标签：仅归档展示，当前固定 craft */
    mode: string
    /** 会话所属作用域（作品目录，形如 press/{作品名}）；NULL 表示不属于任何作品的通用对话 */
    projectDir: string | null
    model: string
    /** 创建会话时使用的 AI 通道，切换通道后旧会话号不再复用 */
    provider: string
    /** 通道侧会话号：CodeBuddy 用于 resume 续接，其它通道为 null */
    sdkSessionId: string | null
    /** 最近一轮请求带上的上下文 token；0 表示尚未记录 */
    contextUsedTokens: number
    /** 该轮生效的上下文窗口；0 表示未知 */
    contextWindowTokens: number
    /** 写入授权范围：document 仅目标文档，project 为整个作品目录 */
    writeGrant: string
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
    /** 本轮消耗的总 token，0 表示未知 */
    totalTokens: number
    /** 本轮耗时（毫秒，墙钟），0 表示未知 */
    durationMs: number
    /** totalTokens 是否为估算值：SQLite 布尔以 0/1 存储 */
    tokensEstimated: number
    /** 本轮真实积分；未对账或未上报为 null（未知不得当成 0） */
    credits: number | null
    /** 通道侧请求 id：用量页对账后按它回填积分 */
    requestId: string | null
    createdAt: string
}

/** 消息可变字段（流式过程中多次更新） */
export interface MessagePatch {
    content: string
    reasoning: string | null
    status: string
    finishReason: string | null
    error: string | null
    /** 与 MessageRow 同口径，生成结束或失败时一并写入 */
    totalTokens: number
    durationMs: number
    tokensEstimated: number
    credits: number | null
    requestId: string | null
}

const CONVERSATION_COLUMNS = `id, title, mode, project_dir AS projectDir, model, provider,
    sdk_session_id AS sdkSessionId, context_used_tokens AS contextUsedTokens,
    context_window_tokens AS contextWindowTokens, write_grant AS writeGrant,
    created_at AS createdAt, updated_at AS updatedAt`

const MESSAGE_COLUMNS = `id, conversation_id AS conversationId, role, content, reasoning, status,
    finish_reason AS finishReason, refs, error, total_tokens AS totalTokens, duration_ms AS durationMs,
    tokens_estimated AS tokensEstimated, credits, request_id AS requestId, created_at AS createdAt`

export function insertConversation(db: Database.Database, row: ConversationRow): void {
    db.prepare(
        `INSERT INTO conversations (id, title, mode, project_dir, model, provider, sdk_session_id,
            context_used_tokens, context_window_tokens, write_grant, created_at, updated_at)
         VALUES (@id, @title, @mode, @projectDir, @model, @provider, @sdkSessionId,
            @contextUsedTokens, @contextWindowTokens, @writeGrant, @createdAt, @updatedAt)`,
    ).run(row)
}

/** 记录写入授权范围：只影响后续发送的工具白名单，不回溯已生成的消息 */
export function updateConversationWriteGrant(db: Database.Database, id: string, grant: string): void {
    db.prepare('UPDATE conversations SET write_grant = ? WHERE id = ?').run(grant, id)
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

/**
 * 记录本轮上下文占用：已用与窗口同写，重开窗口后圆环据此恢复上一轮的数字。
 * 关键约束：只改这两列，不碰 updated_at —— 占用不是会话活跃事件，刷新时间会把会话顶到列表最前。
 */
export function updateConversationContextUsage(
    db: Database.Database,
    id: string,
    usedTokens: number,
    windowTokens: number,
): void {
    // 非有限值与负数一律归零：这两列参与占比计算，NaN 会让整条 SQL 触发 NOT NULL 约束
    const used = Number.isFinite(usedTokens) ? Math.max(Math.trunc(usedTokens), 0) : 0
    const window = Number.isFinite(windowTokens) ? Math.max(Math.trunc(windowTokens), 0) : 0
    db.prepare('UPDATE conversations SET context_used_tokens = ?, context_window_tokens = ? WHERE id = ?').run(
        used,
        window,
        id,
    )
}

export function touchConversation(db: Database.Database, id: string, updatedAt: string): void {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, id)
}

export function deleteConversation(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function insertMessage(db: Database.Database, row: MessageRow): void {
    db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, reasoning, status, finish_reason, refs, error,
            total_tokens, duration_ms, tokens_estimated, credits, request_id, created_at)
         VALUES (@id, @conversationId, @role, @content, @reasoning, @status, @finishReason, @refs, @error,
            @totalTokens, @durationMs, @tokensEstimated, @credits, @requestId, @createdAt)`,
    ).run(row)
}

export function updateMessage(db: Database.Database, id: string, patch: MessagePatch): void {
    db.prepare(
        `UPDATE messages
            SET content = @content, reasoning = @reasoning, status = @status,
                finish_reason = @finishReason, error = @error,
                total_tokens = @totalTokens, duration_ms = @durationMs, tokens_estimated = @tokensEstimated,
                credits = @credits, request_id = @requestId
          WHERE id = @id`,
    ).run({ ...patch, id })
}

/**
 * 按请求 id 回填消息积分：用量页对账拿到 CLI 真实值后修正该轮消息。
 * 关键约束：只在值变化时写入，避免每次对账都产生无效更新；request_id 为 NULL 的历史消息无法关联，保持未知。
 */
export function updateMessageCreditsByRequestId(db: Database.Database, requestId: string, credits: number): number {
    const result = db
        .prepare('UPDATE messages SET credits = ? WHERE request_id = ? AND (credits IS NULL OR credits <> ?)')
        .run(credits, requestId, credits)
    return result.changes
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
