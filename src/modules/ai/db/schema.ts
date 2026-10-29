/**
 * AI 库 DDL：conversations（会话）/ messages（消息）/ ai_usage_logs（用量）/ ai_prompts（提示词）四表与索引。
 * 设计源：docs/modules/ai-chat.md 第 6 节；用量表存模型、模块、成本与请求标识，提示词另表按请求 id 存放，
 * 便于列表查询不触碰正文，也便于按保留期整表清理。
 * 复用约定：activate 期调用一次，建表与补列都走 IF NOT EXISTS / PRAGMA 判断，可重复执行。
 * 关键约束：会话记录所属 AI 通道与通道侧会话号，通道切换后不得复用旧会话号；
 * 会话按作用域（作品目录）隔离，project_dir 为 NULL 表示不属于任何作品的通用对话；
 * 积分只认 CodeBuddy 会话记录里的真实值，v5 起清空按倍率估算的历史值（估算口径已证实偏差约 20 倍）；
 * v9 起用量表记提示词字数，供按真实 token 反算字符/token 比值，历史行留 0 表示未记录；
 * v10 起删除已无读写的遗留列（conversations.file_path、ai_usage_logs.project / estimated_cost），
 * 旧库按 DROP COLUMN 就地清理，新库直接按精简结构建表；
 * 补列与删列的标识符均为本文件内的常量，不接受外部输入，避免拼接注入。
 */
import type Database from 'better-sqlite3'

const SCHEMA_VERSION = '11'

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        mode        TEXT NOT NULL,
        project_dir TEXT,
        model       TEXT NOT NULL,
        provider    TEXT NOT NULL DEFAULT 'codebuddy',
        sdk_session_id TEXT,
        context_used_tokens   INTEGER NOT NULL DEFAULT 0,
        context_window_tokens INTEGER NOT NULL DEFAULT 0,
        write_grant TEXT NOT NULL DEFAULT 'project',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        reasoning       TEXT,
        status          TEXT NOT NULL,
        finish_reason   TEXT,
        refs            TEXT NOT NULL DEFAULT '[]',
        error           TEXT,
        total_tokens    INTEGER NOT NULL DEFAULT 0,
        duration_ms     INTEGER NOT NULL DEFAULT 0,
        tokens_estimated INTEGER NOT NULL DEFAULT 0,
        credits         REAL,
        request_id      TEXT,
        created_at      TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT,
        model             TEXT NOT NULL,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
        total_tokens      INTEGER NOT NULL DEFAULT 0,
        latency_ms        INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_usage_date ON ai_usage_logs(created_at)`,
    `CREATE TABLE IF NOT EXISTS ai_prompts (
        request_id    TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        is_truncated  INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_prompt_date ON ai_prompts(created_at)`,
    `CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 读取已写入的 schema 版本：旧库没有该行时按 0 处理，用于判断是否需要执行数据修订 */
function readSchemaVersion(db: Database.Database): number {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    if (row === undefined) {
        return 0
    }
    const version = Number(row.value)
    return Number.isFinite(version) ? version : 0
}

/** 判断列是否存在：补列与删列都要先查 PRAGMA，SQLite 没有 IF [NOT] EXISTS */
function hasColumn(db: Database.Database, table: string, name: string): boolean {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return columns.some((item) => item.name === name)
}

/** 旧库补列：SQLite 的 ADD COLUMN 没有 IF NOT EXISTS，只能先查 PRAGMA 再执行 */
function ensureColumn(db: Database.Database, table: string, name: string, definition: string): void {
    if (!hasColumn(db, table, name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
    }
}

/** 旧库删列：DROP COLUMN 会因列上仍有索引而失败，调用方须先删索引 */
function dropColumn(db: Database.Database, table: string, name: string): void {
    if (hasColumn(db, table, name)) {
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`)
    }
}

/** 确保 AI 库 schema 存在并写入 schema_version；返回是否为全新建库 */
export function ensureAiSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        // v2：会话记录所属通道与通道侧会话号，供 CodeBuddy 通道续接
        ensureColumn(db, 'conversations', 'provider', "provider TEXT NOT NULL DEFAULT 'codebuddy'")
        ensureColumn(db, 'conversations', 'sdk_session_id', 'sdk_session_id TEXT')
        // v3：会话所属作用域（作品目录），历史会话保持 NULL 即通用对话，不做回填；
        // 依赖该列的索引必须放在补列之后，否则旧库建索引会因缺列失败
        ensureColumn(db, 'conversations', 'project_dir', 'project_dir TEXT')
        db.exec('CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_dir, updated_at DESC)')
        // v4：用量表补模块、请求标识与成本口径；历史行按 'chat' 归一，不回填其余字段
        ensureColumn(db, 'ai_usage_logs', 'module', "module TEXT NOT NULL DEFAULT 'chat'")
        ensureColumn(db, 'ai_usage_logs', 'request_id', 'request_id TEXT')
        ensureColumn(db, 'ai_usage_logs', 'sdk_message_id', 'sdk_message_id TEXT')
        ensureColumn(db, 'ai_usage_logs', 'cost_usd', 'cost_usd REAL NOT NULL DEFAULT 0')
        ensureColumn(db, 'ai_usage_logs', 'credits', 'credits REAL')
        ensureColumn(db, 'ai_usage_logs', 'cache_read_tokens', 'cache_read_tokens INTEGER NOT NULL DEFAULT 0')
        ensureColumn(db, 'ai_usage_logs', 'cache_creation_tokens', 'cache_creation_tokens INTEGER NOT NULL DEFAULT 0')
        ensureColumn(db, 'ai_usage_logs', 'status', "status TEXT NOT NULL DEFAULT 'completed'")
        // 依赖新列的索引必须放在补列之后，否则旧库建索引会因缺列失败
        db.exec('CREATE INDEX IF NOT EXISTS idx_usage_module_date ON ai_usage_logs(module, created_at DESC)')
        // v5：积分改由 CodeBuddy 会话记录回填，清空按倍率估算的历史值
        if (readSchemaVersion(db) < 5) {
            db.exec('UPDATE ai_usage_logs SET credits = NULL')
        }
        // v6：消息表补本轮用量与耗时，供消息底部工具栏展示；历史消息保持 0 即「未知」，不做回填
        ensureColumn(db, 'messages', 'total_tokens', 'total_tokens INTEGER NOT NULL DEFAULT 0')
        ensureColumn(db, 'messages', 'duration_ms', 'duration_ms INTEGER NOT NULL DEFAULT 0')
        ensureColumn(db, 'messages', 'tokens_estimated', 'tokens_estimated INTEGER NOT NULL DEFAULT 0')
        // v7：消息表补本轮真实积分与请求 id：积分晚落盘时由用量页按请求 id 对账回填，缺失保持 NULL 即未知
        ensureColumn(db, 'messages', 'credits', 'credits REAL')
        ensureColumn(db, 'messages', 'request_id', 'request_id TEXT')
        db.exec('CREATE INDEX IF NOT EXISTS idx_msg_request ON messages(request_id)')
        // v8：会话表补上下文占用（已用 / 窗口），重开窗口后圆环仍能恢复上一轮的数字；
        // 历史会话两项均为 0，表示尚未记录过占用，由展示层按运行时窗口补分母
        ensureColumn(db, 'conversations', 'context_used_tokens', 'context_used_tokens INTEGER NOT NULL DEFAULT 0')
        ensureColumn(db, 'conversations', 'context_window_tokens', 'context_window_tokens INTEGER NOT NULL DEFAULT 0')
        // v9：用量表补提示词字数，用于按真实 token 反算「字符 / token」比值，替代写死的 1.6；
        // 历史行保持 0 即「未记录」，统计时被过滤，不影响校准结果
        ensureColumn(db, 'ai_usage_logs', 'prompt_chars', 'prompt_chars INTEGER NOT NULL DEFAULT 0')
        // v10：删除已无读写的遗留列 —— 会话不再按文件归属，用量表由 module / cost_usd 取代 project / estimated_cost；
        // 先删索引再删列（SQLite 不允许 DROP 仍被索引引用的列），新库本就没有这些列，hasColumn 会直接跳过
        db.exec('DROP INDEX IF EXISTS idx_conv_file')
        dropColumn(db, 'conversations', 'file_path')
        dropColumn(db, 'ai_usage_logs', 'project')
        dropColumn(db, 'ai_usage_logs', 'estimated_cost')
        // v11：会话表补写入授权范围，write 模式据此决定工具白名单边界；
        // 历史会话默认 project（有作品目录时授权整个作品），与「连续生成章节」的主用法一致
        ensureColumn(db, 'conversations', 'write_grant', "write_grant TEXT NOT NULL DEFAULT 'project'")
        db.prepare(
            'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run('schema_version', SCHEMA_VERSION)
    })()
    return isCreated
}
