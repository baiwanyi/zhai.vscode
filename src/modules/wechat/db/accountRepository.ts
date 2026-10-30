/**
 * 公众号账号仓储：wechat_accounts 的全部读写，供账号服务的列表、创建、更新、删除与鉴权回写共用。
 * 复用约定：SQL 全部走 better-sqlite3 预编译语句，不做字符串拼接；行列命名由本文件统一映射，
 * 调用方不接触 snake_case，也不直接持有 Database 实例之外的连接状态。
 * 关键约束：库内永不写入 AppSecret（凭证在 SecretStorage），本文件因此没有任何密钥列；
 * app_id 唯一，重复添加由 SQLite 的 UNIQUE 约束兜底，调用方负责把约束错误翻译成可读提示；
 * 批次计数与最近推送时间取自 wechat_issues，账号表内的冗余列只在写入批次后由推送侧回填。
 */
import type Database from 'better-sqlite3'

/** 账号行：字段名与 DDL 一致，仅在仓储内部使用 */
export interface WechatAccountRow {
    id: string
    name: string
    avatar: string | null
    app_id: string
    account_type: string
    verified: number
    status: string
    last_error_code: number | null
    status_hint: string | null
    fan_count: number
    issue_count: number
    last_publish_at: string | null
    created_at: string
    updated_at: string
}

/** 新建账号的落库字段：密钥不在此列 */
export interface WechatAccountRecord {
    id: string
    name: string
    avatar: string | null
    appId: string
    accountType: string
    status: string
    createdAt: string
}

/** 账号资料更新：不含密钥与鉴权状态 */
export interface WechatAccountProfilePatch {
    id: string
    name: string
    appId: string
    accountType: string
    updatedAt: string
}

/** 鉴权结果回写：状态、错误码与提示一并落库，重启后列表仍能给出可执行指引 */
export interface WechatAccountAuthPatch {
    id: string
    status: string
    errorCode: number | null
    statusHint: string | null
    updatedAt: string
}

/** 批次聚合：按账号统计批次数与最近推送时间 */
export interface WechatIssueMetric {
    issueCount: number
    lastPublishAt: string | null
}

/** 列出全部账号，按最近更新倒序 */
export function listWechatAccounts(db: Database.Database): WechatAccountRow[] {
    return db.prepare('SELECT * FROM wechat_accounts ORDER BY updated_at DESC, id ASC').all() as WechatAccountRow[]
}

/** 按本地 id 查账号，不存在返回 null */
export function findWechatAccount(db: Database.Database, id: string): WechatAccountRow | null {
    const row = db.prepare('SELECT * FROM wechat_accounts WHERE id = ?').get(id)
    return row === undefined ? null : (row as WechatAccountRow)
}

/** 按 AppID 查账号：用于创建前的重复校验与提示 */
export function findWechatAccountByAppId(db: Database.Database, appId: string): WechatAccountRow | null {
    const row = db.prepare('SELECT * FROM wechat_accounts WHERE app_id = ?').get(appId)
    return row === undefined ? null : (row as WechatAccountRow)
}

/** 插入账号：唯一约束冲突时抛出 better-sqlite3 原始错误，由服务层翻译 */
export function insertWechatAccount(db: Database.Database, record: WechatAccountRecord): void {
    db.prepare(
        `INSERT INTO wechat_accounts
            (id, name, avatar, app_id, account_type, verified, status, fan_count, issue_count, created_at, updated_at)
         VALUES
            (@id, @name, @avatar, @appId, @accountType, 0, @status, 0, 0, @createdAt, @createdAt)`,
    ).run(record)
}

/** 更新账号资料：名称、AppID 与类型；鉴权状态由 updateWechatAccountAuth 单独维护 */
export function updateWechatAccountProfile(db: Database.Database, patch: WechatAccountProfilePatch): void {
    db.prepare(
        `UPDATE wechat_accounts
            SET name = @name, app_id = @appId, account_type = @accountType, updated_at = @updatedAt
          WHERE id = @id`,
    ).run(patch)
}

/** 回写鉴权结果：成功后清空错误码与提示，失败时保留可执行指引 */
export function updateWechatAccountAuth(db: Database.Database, patch: WechatAccountAuthPatch): void {
    db.prepare(
        `UPDATE wechat_accounts
            SET status = @status, last_error_code = @errorCode, status_hint = @statusHint, updated_at = @updatedAt
          WHERE id = @id`,
    ).run(patch)
}

/** 删除账号行：只删本表记录，密钥由服务层同步清理 */
export function deleteWechatAccount(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM wechat_accounts WHERE id = ?').run(id)
}

/** 聚合各账号的批次数与最近推送时间：一次查询取全量，避免列表 N+1 */
export function readWechatIssueMetrics(db: Database.Database): Map<string, WechatIssueMetric> {
    const rows = db
        .prepare(
            `SELECT account_id, COUNT(*) AS issue_count, MAX(published_at) AS last_publish_at
               FROM wechat_issues
              GROUP BY account_id`,
        )
        .all() as { account_id: string; issue_count: number; last_publish_at: string | null }[]
    const metrics = new Map<string, WechatIssueMetric>()
    for (const row of rows) {
        metrics.set(row.account_id, { issueCount: row.issue_count, lastPublishAt: row.last_publish_at })
    }
    return metrics
}
