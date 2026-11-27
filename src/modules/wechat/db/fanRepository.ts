/**
 * 用户管理仓储：wechat_fans / wechat_tags / wechat_sync_tasks 的读写。
 * 复用约定：沿用其它仓储的纯函数风格，首参统一传库连接，行列字段在本文件完成 snake_case 与 camelCase 映射；
 * 检索条件全部走命名参数，关键词里的 LIKE 通配符先转义，不把用户输入拼进 SQL 文本。
 * 关键约束：平台是唯一真相，upsert 覆盖上一次快照而不是做增量合并；同一账号的清理放在一个事务内完成，
 * 避免账号删除后留下打不开的用户与任务行；标签 id 用 json_each 精确匹配，防止 3 命中 13；
 * 黑名单位先清后标放在同一事务，boolean 在绑定前转成 0/1，避免 SQLite 类型错误。
 */
import type Database from 'better-sqlite3'

/** 用户快照行：字段名与 DDL 一致 */
export interface WechatFanRow {
    account_id: string
    openid: string
    unionid: string | null
    nickname: string
    avatar: string | null
    subscribe_status: number
    subscribed_at: string | null
    remark: string | null
    country: string | null
    province: string | null
    city: string | null
    language: string | null
    subscribe_scene: string | null
    qr_scene: string | null
    tag_ids: string
    is_blocked: number
    last_synced_at: string
    created_at: string
    updated_at: string
}

/** 标签行 */
export interface WechatTagRow {
    account_id: string
    tag_id: number
    name: string
    count: number
    updated_at: string
}

/** 同步任务行 */
export interface WechatSyncTaskRow {
    id: string
    account_id: string
    status: string
    cursor: string
    page_count: number
    fetched: number
    created_count: number
    updated_count: number
    unfollowed: number
    failed_count: number
    total: number
    error_code: number | null
    error_hint: string | null
    started_at: string
    finished_at: string | null
}

/** 写入用户快照的字段 */
export interface WechatFanRecord {
    accountId: string
    openid: string
    unionid: string | null
    nickname: string
    avatar: string | null
    subscribeStatus: number
    subscribedAt: string | null
    remark: string | null
    country: string | null
    province: string | null
    city: string | null
    language: string | null
    subscribeScene: string | null
    qrScene: string | null
    tagIds: string
    isBlocked: boolean
    lastSyncedAt: string
    createdAt: string
    updatedAt: string
}

/** 写入标签的字段 */
export interface WechatTagRecord {
    accountId: string
    tagId: number
    name: string
    count: number
    updatedAt: string
}

/** 写入同步任务的字段 */
export interface WechatSyncTaskRecord {
    id: string
    accountId: string
    status: string
    cursor: string
    pageCount: number
    fetched: number
    createdCount: number
    updatedCount: number
    unfollowed: number
    failedCount: number
    total: number
    errorCode: number | null
    errorHint: string | null
    startedAt: string
    finishedAt: string | null
}

/** 本地检索条件：全部可选，缺省即不限 */
export interface WechatFanFilter {
    keyword?: string
    tagId?: number
    subscribeStatus?: 0 | 1
    /** true 只看黑名单用户；与 subscribeStatus 互斥 */
    isBlocked?: boolean
    limit?: number
    offset?: number
}

/** 转义 LIKE 通配符：用户输入里的 \ % _ 只作普通字符 */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&')
}

/** 把检索条件变成命名参数；关键词同时匹配昵称、备注与 openid 尾号 */
function filterParams(accountId: string, filter: WechatFanFilter): Record<string, string | number | null> {
    const keyword = filter.keyword === undefined ? '' : filter.keyword.trim()
    const escaped = keyword.length === 0 ? null : escapeLike(keyword)
    return {
        accountId,
        keywordPattern: escaped === null ? null : `%${escaped}%`,
        openidPattern: escaped === null ? null : `%${escapeLike(keyword.slice(-6))}`,
        tagId: filter.tagId ?? null,
        subscribeStatus: filter.subscribeStatus ?? null,
        isBlocked: filter.isBlocked === undefined ? null : filter.isBlocked ? 1 : 0,
        limit: filter.limit ?? 100,
        offset: filter.offset ?? 0,
    }
}

/** 检索快照：关注中优先、按关注时间倒序，已取关与未知时间排末尾 */
export function listWechatFans(db: Database.Database, accountId: string, filter: WechatFanFilter): WechatFanRow[] {
    return db
        .prepare(
            `SELECT * FROM wechat_fans
              WHERE account_id = @accountId
                AND (@keywordPattern IS NULL OR nickname LIKE @keywordPattern ESCAPE '\\'
                     OR remark LIKE @keywordPattern ESCAPE '\\'
                     OR openid LIKE @openidPattern ESCAPE '\\')
                AND (@tagId IS NULL OR EXISTS (
                     SELECT 1 FROM json_each(wechat_fans.tag_ids) WHERE json_each.value = @tagId))
                AND (@subscribeStatus IS NULL OR subscribe_status = @subscribeStatus)
                AND (@isBlocked IS NULL OR is_blocked = @isBlocked)
              ORDER BY subscribe_status DESC, subscribed_at DESC, openid ASC
              LIMIT @limit OFFSET @offset`,
        )
        .all(filterParams(accountId, filter)) as WechatFanRow[]
}

/** 统计命中的快照条数：与 listWechatFans 共用同一组条件 */
export function countWechatFans(db: Database.Database, accountId: string, filter: WechatFanFilter): number {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS total FROM wechat_fans
              WHERE account_id = @accountId
                AND (@keywordPattern IS NULL OR nickname LIKE @keywordPattern ESCAPE '\\'
                     OR remark LIKE @keywordPattern ESCAPE '\\'
                     OR openid LIKE @openidPattern ESCAPE '\\')
                AND (@tagId IS NULL OR EXISTS (
                     SELECT 1 FROM json_each(wechat_fans.tag_ids) WHERE json_each.value = @tagId))
                AND (@subscribeStatus IS NULL OR subscribe_status = @subscribeStatus)
                AND (@isBlocked IS NULL OR is_blocked = @isBlocked)`,
        )
        .get(filterParams(accountId, filter)) as { total: number }
    return row.total
}

/** 快照总条数：不受筛选影响 */
export function countAllWechatFans(db: Database.Database, accountId: string): number {
    const row = db.prepare('SELECT COUNT(*) AS total FROM wechat_fans WHERE account_id = ?').get(accountId) as {
        total: number
    }
    return row.total
}

/** 按 openid 查单个用户 */
export function findWechatFan(db: Database.Database, accountId: string, openid: string): WechatFanRow | null {
    const row = db.prepare('SELECT * FROM wechat_fans WHERE account_id = ? AND openid = ?').get(accountId, openid)
    return row === undefined ? null : (row as WechatFanRow)
}

/** 按 UnionID 查同账号下的用户：跨账号关联由服务层逐账号调用 */
export function findWechatFansByUnionid(db: Database.Database, accountId: string, unionid: string): WechatFanRow[] {
    return db
        .prepare('SELECT * FROM wechat_fans WHERE account_id = ? AND unionid = ?')
        .all(accountId, unionid) as WechatFanRow[]
}

/** 写入或覆盖用户快照：唯一键为 (account_id, openid) */
export function upsertWechatFan(db: Database.Database, record: WechatFanRecord): void {
    db.prepare(
        `INSERT INTO wechat_fans
            (account_id, openid, unionid, nickname, avatar, subscribe_status, subscribed_at,
             remark, country, province, city, language, subscribe_scene, qr_scene,
             tag_ids, is_blocked, last_synced_at, created_at, updated_at)
         VALUES
            (@accountId, @openid, @unionid, @nickname, @avatar, @subscribeStatus, @subscribedAt,
             @remark, @country, @province, @city, @language, @subscribeScene, @qrScene,
             @tagIds, @isBlocked, @lastSyncedAt, @createdAt, @updatedAt)
         ON CONFLICT(account_id, openid) DO UPDATE SET
            unionid = excluded.unionid,
            nickname = excluded.nickname,
            avatar = excluded.avatar,
            subscribe_status = excluded.subscribe_status,
            subscribed_at = excluded.subscribed_at,
            remark = excluded.remark,
            country = excluded.country,
            province = excluded.province,
            city = excluded.city,
            language = excluded.language,
            subscribe_scene = excluded.subscribe_scene,
            qr_scene = excluded.qr_scene,
            tag_ids = excluded.tag_ids,
            is_blocked = excluded.is_blocked,
            last_synced_at = excluded.last_synced_at,
            updated_at = excluded.updated_at`,
    ).run({ ...record, isBlocked: record.isBlocked ? 1 : 0 })
}

/** 打标或取消后更新单个用户的标签列表 */
export function updateWechatFanTagIds(
    db: Database.Database,
    accountId: string,
    openid: string,
    tagIds: string,
    updatedAt: string,
): void {
    db.prepare('UPDATE wechat_fans SET tag_ids = ?, updated_at = ? WHERE account_id = ? AND openid = ?').run(
        tagIds,
        updatedAt,
        accountId,
        openid,
    )
}

/** 备注写成功后同步本地快照：空串写入 NULL，与平台「清除备注」口径一致 */
export function updateWechatFanRemark(
    db: Database.Database,
    accountId: string,
    openid: string,
    remark: string,
    updatedAt: string,
): void {
    db.prepare('UPDATE wechat_fans SET remark = ?, updated_at = ? WHERE account_id = ? AND openid = ?').run(
        remark.length === 0 ? null : remark,
        updatedAt,
        accountId,
        openid,
    )
}

/**
 * 全量回读黑名单：先清掉该账号所有标记，再把平台返回的 openid 标为已拉黑。
 * 放在一个事务内，避免清理与标记之间被其它读请求看到中间态。
 */
export function syncWechatFanBlocked(
    db: Database.Database,
    accountId: string,
    openids: string[],
    updatedAt: string,
): void {
    db.transaction(() => {
        db.prepare('UPDATE wechat_fans SET is_blocked = 0, updated_at = ? WHERE account_id = ?').run(
            updatedAt,
            accountId,
        )
        if (openids.length === 0) {
            return
        }
        const mark = db.prepare(
            'UPDATE wechat_fans SET is_blocked = 1, updated_at = ? WHERE account_id = ? AND openid = ?',
        )
        for (const openid of openids) {
            mark.run(updatedAt, accountId, openid)
        }
    })()
}

/** 拉黑或解除成功后只改本次涉及的 openid，其余快照字段不动 */
export function updateWechatFanBlocked(
    db: Database.Database,
    accountId: string,
    openids: string[],
    isBlocked: boolean,
    updatedAt: string,
): void {
    const update = db.prepare(
        'UPDATE wechat_fans SET is_blocked = ?, updated_at = ? WHERE account_id = ? AND openid = ?',
    )
    db.transaction(() => {
        for (const openid of openids) {
            update.run(isBlocked ? 1 : 0, updatedAt, accountId, openid)
        }
    })()
}

/** 列出账号标签，按平台 id 升序 */
export function listWechatTags(db: Database.Database, accountId: string): WechatTagRow[] {
    return db
        .prepare('SELECT * FROM wechat_tags WHERE account_id = ? ORDER BY tag_id ASC')
        .all(accountId) as WechatTagRow[]
}

/** 写入或覆盖标签名称与人数 */
export function upsertWechatTag(db: Database.Database, record: WechatTagRecord): void {
    db.prepare(
        `INSERT INTO wechat_tags (account_id, tag_id, name, count, updated_at)
         VALUES (@accountId, @tagId, @name, @count, @updatedAt)
         ON CONFLICT(account_id, tag_id) DO UPDATE SET
            name = excluded.name,
            count = excluded.count,
            updated_at = excluded.updated_at`,
    ).run(record)
}

/** 删除本地标签映射：平台侧由调用方先行删除 */
export function deleteWechatTag(db: Database.Database, accountId: string, tagId: number): void {
    db.prepare('DELETE FROM wechat_tags WHERE account_id = ? AND tag_id = ?').run(accountId, tagId)
}

/** 新建同步任务 */
export function insertSyncTask(db: Database.Database, record: WechatSyncTaskRecord): void {
    db.prepare(
        `INSERT INTO wechat_sync_tasks
            (id, account_id, status, cursor, page_count, fetched, created_count, updated_count,
             unfollowed, failed_count, total, error_code, error_hint, started_at, finished_at)
         VALUES
            (@id, @accountId, @status, @cursor, @pageCount, @fetched, @createdCount, @updatedCount,
             @unfollowed, @failedCount, @total, @errorCode, @errorHint, @startedAt, @finishedAt)`,
    ).run(record)
}

/** 覆盖同步任务：每批处理完都写回游标与计数，供断点续跑 */
export function updateSyncTask(db: Database.Database, record: WechatSyncTaskRecord): void {
    db.prepare(
        `UPDATE wechat_sync_tasks SET
            status = @status, cursor = @cursor, page_count = @pageCount, fetched = @fetched,
            created_count = @createdCount, updated_count = @updatedCount, unfollowed = @unfollowed,
            failed_count = @failedCount, total = @total, error_code = @errorCode,
            error_hint = @errorHint, finished_at = @finishedAt
         WHERE id = @id AND account_id = @accountId`,
    ).run(record)
}

/** 按 id 查同步任务 */
export function findSyncTask(db: Database.Database, accountId: string, taskId: string): WechatSyncTaskRow | null {
    const row = db.prepare('SELECT * FROM wechat_sync_tasks WHERE id = ? AND account_id = ?').get(taskId, accountId)
    return row === undefined ? null : (row as WechatSyncTaskRow)
}

/** 查最近一次同步任务：页面进入时展示进度与时间戳 */
export function latestSyncTask(db: Database.Database, accountId: string): WechatSyncTaskRow | null {
    const row = db
        .prepare('SELECT * FROM wechat_sync_tasks WHERE account_id = ? ORDER BY started_at DESC, id DESC LIMIT 1')
        .get(accountId)
    return row === undefined ? null : (row as WechatSyncTaskRow)
}

/** 原子清理一个账号的用户管理数据：账号删除时调用 */
export function deleteAccountFanData(db: Database.Database, accountId: string): void {
    db.transaction(() => {
        db.prepare('DELETE FROM wechat_fans WHERE account_id = ?').run(accountId)
        db.prepare('DELETE FROM wechat_tags WHERE account_id = ?').run(accountId)
        db.prepare('DELETE FROM wechat_sync_tasks WHERE account_id = ?').run(accountId)
    })()
}
