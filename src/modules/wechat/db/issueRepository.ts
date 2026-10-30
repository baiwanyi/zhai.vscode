/**
 * 推送批次与文章的仓储：wechat_issues / wechat_articles 的全部读写。
 * 复用约定：SQL 全部走 better-sqlite3 预编译语句，批量写入与删除包在事务里；
 * 行列命名由本文件统一映射，调用方不接触 snake_case，也不自行拼装排序号。
 * 关键约束：删除批次必须同事务删掉其文章，避免留下无主正文；删除文章后重排 sort_index，
 * 保证界面上的序号连续（微信侧 articles 数组顺序即推送顺序，空号会让用户误判）；
 * article_count 是列表展示用的冗余列，任何增删文章的操作都须同步刷新。
 */
import type Database from 'better-sqlite3'

/** 批次行：字段名与 DDL 一致，仅在仓储内部使用 */
export interface WechatIssueRow {
    id: string
    account_id: string
    title: string
    cover_url: string | null
    cover_media_id: string | null
    article_count: number
    status: string
    media_id: string | null
    publish_id: string | null
    article_url: string | null
    error_code: number | null
    error_hint: string | null
    scheduled_at: string | null
    published_at: string | null
    updated_at: string
}

/** 文章行：body 为 Markdown 源文，body_hash 用于幂等与「源文件已变更」判定 */
export interface WechatArticleRow {
    id: string
    issue_id: string
    sort_index: number
    title: string
    author: string | null
    digest: string | null
    body: string
    body_hash: string
    word_count: number
    cover_media_id: string | null
    source_kind: string
    source_path: string | null
    is_original: number
    allow_comment: number
    read_num: number
    like_num: number
}

/** 新建批次的落库字段 */
export interface WechatIssueRecord {
    id: string
    accountId: string
    title: string
    status: string
    createdAt: string
}

/** 新建文章的落库字段 */
export interface WechatArticleRecord {
    id: string
    issueId: string
    title: string
    author: string | null
    digest: string | null
    body: string
    bodyHash: string
    wordCount: number
    sourceKind: string
    sourcePath: string | null
}

/** 文章可编辑字段：标题、作者、摘要与正文 */
export interface WechatArticlePatch {
    id: string
    title: string
    author: string | null
    digest: string | null
    body: string
    bodyHash: string
    wordCount: number
}

/** 列出某账号的全部批次，按最近更新倒序 */
export function listWechatIssues(db: Database.Database, accountId: string): WechatIssueRow[] {
    return db
        .prepare('SELECT * FROM wechat_issues WHERE account_id = ? ORDER BY updated_at DESC, id ASC')
        .all(accountId) as WechatIssueRow[]
}

/** 按 id 查批次 */
export function findWechatIssue(db: Database.Database, id: string): WechatIssueRow | null {
    const row = db.prepare('SELECT * FROM wechat_issues WHERE id = ?').get(id)
    return row === undefined ? null : (row as WechatIssueRow)
}

/** 插入批次：article_count 与 status 由调用方给出，写入即视为草稿 */
export function insertWechatIssue(db: Database.Database, record: WechatIssueRecord): void {
    db.prepare(
        `INSERT INTO wechat_issues (id, account_id, title, article_count, status, updated_at)
         VALUES (@id, @accountId, @title, 0, @status, @createdAt)`,
    ).run(record)
}

/** 更新批次标题 */
export function updateWechatIssueTitle(db: Database.Database, id: string, title: string, updatedAt: string): void {
    db.prepare('UPDATE wechat_issues SET title = @title, updated_at = @updatedAt WHERE id = @id').run({
        id,
        title,
        updatedAt,
    })
}

/** 刷新批次的文章数与更新时间：增删文章后调用 */
export function syncWechatIssueArticleCount(db: Database.Database, id: string, updatedAt: string): number {
    const count = readWechatArticleCount(db, id)
    db.prepare('UPDATE wechat_issues SET article_count = @count, updated_at = @updatedAt WHERE id = @id').run({
        id,
        count,
        updatedAt,
    })
    return count
}

/** 删除批次及其文章：同事务执行，避免留下无主正文 */
export function deleteWechatIssue(db: Database.Database, id: string): void {
    db.transaction(() => {
        db.prepare('DELETE FROM wechat_articles WHERE issue_id = ?').run(id)
        db.prepare('DELETE FROM wechat_issues WHERE id = ?').run(id)
    })()
}

/** 列出某批次的文章，按顺序号升序 */
export function listWechatArticles(db: Database.Database, issueId: string): WechatArticleRow[] {
    return db
        .prepare('SELECT * FROM wechat_articles WHERE issue_id = ? ORDER BY sort_index ASC')
        .all(issueId) as WechatArticleRow[]
}

/** 一次取出多个批次的文章：列表页据此渲染每个批次的前若干条，避免逐批次查询 */
export function listWechatArticlesByIssues(db: Database.Database, issueIds: string[]): WechatArticleRow[] {
    if (issueIds.length === 0) {
        return []
    }
    const placeholders = issueIds.map(() => '?').join(', ')
    return db
        .prepare(
            `SELECT id, issue_id, sort_index, title, author, digest, source_kind, source_path, word_count
               FROM wechat_articles
              WHERE issue_id IN (${placeholders})
              ORDER BY issue_id ASC, sort_index ASC`,
        )
        .all(...issueIds) as WechatArticleRow[]
}

/** 按 id 查文章（含正文） */
export function findWechatArticle(db: Database.Database, id: string): WechatArticleRow | null {
    const row = db.prepare('SELECT * FROM wechat_articles WHERE id = ?').get(id)
    return row === undefined ? null : (row as WechatArticleRow)
}

/** 插入文章：顺序号取当前最大序号 + 1 */
export function insertWechatArticle(db: Database.Database, record: WechatArticleRecord): number {
    const nextIndex = readWechatArticleCount(db, record.issueId) + 1
    db.prepare(
        `INSERT INTO wechat_articles
            (id, issue_id, sort_index, title, author, digest, body, body_hash, word_count, source_kind, source_path)
         VALUES
            (@id, @issueId, @nextIndex, @title, @author, @digest, @body, @bodyHash, @wordCount, @sourceKind, @sourcePath)`,
    ).run({ ...record, nextIndex })
    return nextIndex
}

/** 更新文章可编辑字段：顺序号与来源不变 */
export function updateWechatArticle(db: Database.Database, patch: WechatArticlePatch): void {
    db.prepare(
        `UPDATE wechat_articles
            SET title = @title, author = @author, digest = @digest,
                body = @body, body_hash = @bodyHash, word_count = @wordCount
          WHERE id = @id`,
    ).run(patch)
}

/** 删除文章并重排剩余序号，保证界面与推送顺序连续 */
export function deleteWechatArticle(db: Database.Database, id: string): void {
    db.transaction(() => {
        const row = db.prepare('SELECT issue_id FROM wechat_articles WHERE id = ?').get(id) as
            { issue_id: string } | undefined
        if (row === undefined) {
            return
        }
        db.prepare('DELETE FROM wechat_articles WHERE id = ?').run(id)
        const remaining = db
            .prepare('SELECT id FROM wechat_articles WHERE issue_id = ? ORDER BY sort_index ASC')
            .all(row.issue_id) as { id: string }[]
        const restate = db.prepare('UPDATE wechat_articles SET sort_index = ? WHERE id = ?')
        remaining.forEach((item, index) => {
            restate.run(index + 1, item.id)
        })
    })()
}

/** 统计批次内文章数 */
export function readWechatArticleCount(db: Database.Database, issueId: string): number {
    const row = db.prepare('SELECT COUNT(*) AS count FROM wechat_articles WHERE issue_id = ?').get(issueId) as
        { count: number } | undefined
    return row?.count ?? 0
}
