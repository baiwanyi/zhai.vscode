/**
 * 推送批次服务：批次与文章的增删改查、从笔记/作品文档导入，是公众号批次侧的唯一编排层。
 * 复用约定：落库走 db/issueRepository，源文档的元数据解析复用 common/db/fileMeta 的
 * splitFrontmatter / parseTitle / countWords / contentHash，路径构造与校验复用 common/storagePath 与 config。
 * 关键约束：批次最多 8 篇、正文最多 2 万字（平台上限），超出直接拒绝并给出可执行提示；
 * 导入不接收前端传入的路径——源文件由宿主弹出选择器、回查索引库后再读盘，从源头排除任意文件读取；
 * 文章只存 Markdown 源文，内联样式 HTML 在推送前统一渲染，因此模板变更无需重新导入；
 * 任何增删文章的操作都要同步批次 article_count 与 updated_at，否则列表显示与实际不一致。
 */
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { countWords, contentHash, parseTitle, splitFrontmatter } from '@modules/common/db/fileMeta'
import { findIndexedFile } from '@modules/common/db/indexRepository'
import { buildStorageUri } from '@modules/common/storagePath'
import {
    readWechatArticleAuthor,
    readWechatArticleDigest,
    readWechatArticleTitle,
    WECHAT_ARTICLE_BODY_MAX,
    WECHAT_ISSUE_ARTICLE_LIMIT,
    WECHAT_ISSUE_TITLE_MAX,
    type WechatArticleCreateRequest,
    type WechatArticleCreateResult,
    type WechatArticleDetail,
    type WechatArticleImportRequest,
    type WechatArticleImportResult,
    type WechatArticleRemoveResult,
    type WechatArticleSummary,
    type WechatArticleUpdateRequest,
    type WechatArticleUpdateResult,
    type WechatIssueCreateRequest,
    type WechatIssueCreateResult,
    type WechatIssueDetailResult,
    type WechatIssueRemoveResult,
    type WechatIssueStatus,
    type WechatIssueSummary,
} from '@shared/types/wechat'
import { findWechatAccount } from './db/accountRepository'
import {
    deleteWechatArticle,
    deleteWechatIssue,
    findWechatArticle,
    findWechatIssue,
    insertWechatArticle,
    insertWechatIssue,
    listWechatArticles,
    listWechatArticlesByIssues,
    listWechatIssues,
    readWechatArticleCount,
    syncWechatIssueArticleCount,
    updateWechatArticle,
} from './db/issueRepository'
import type { WechatArticleRow, WechatIssueRow } from './db/issueRepository'
import type Database from 'better-sqlite3'

/** 服务依赖：公众号库与索引库（导入源文档的校验与标题来源） */
export interface WechatIssueServiceDeps {
    db: Database.Database
    /** 索引库：只用于按路径回查文档是否被收录 */
    indexDb: Database.Database
}

/** 导入时允许的源模块：与一级目录名一致 */
const SOURCE_MODULE_DIRS = { note: 'notes', press: 'press' } as const

/** 早于该时间前导入的源文档若已改写，界面以 body_hash 与索引 mtime 对比提示（M3 推送前复核） */
const DEFAULT_ISSUE_TITLE_PREFIX = '未命名批次'

/** 收窄库内状态：脏数据按草稿处理，避免前端拿到未知状态 */
function readIssueStatus(value: string): WechatIssueStatus {
    switch (value) {
        case 'ready':
        case 'scheduled':
        case 'pushing':
        case 'published':
        case 'failed':
            return value
        default:
            return 'draft'
    }
}

/** 行 → 文章摘要：列表不返回正文，只带字数与来源 */
function toArticleSummary(row: WechatArticleRow): WechatArticleSummary {
    return {
        id: row.id,
        sortIndex: row.sort_index,
        title: row.title,
        ...(row.author === null ? {} : { author: row.author }),
        ...(row.digest === null ? {} : { digest: row.digest }),
        sourceKind: row.source_kind === 'note' || row.source_kind === 'press' ? row.source_kind : 'manual',
        ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
        wordCount: row.word_count,
    }
}

/** 行 → 文章详情：附带 Markdown 源文 */
function toArticleDetail(row: WechatArticleRow): WechatArticleDetail {
    return { ...toArticleSummary(row), body: row.body }
}

/**
 * 从文档正文剥掉首个一级标题：公众号标题单独填写，正文再出现一次会重复。
 * 关键约束：只剥第一处且必须位于正文最前（允许前置空行），正文中间的标题保持原样。
 */
function stripLeadingHeading(body: string): string {
    return body.replace(/^\s*#\s+.+(\r?\n)+/, '')
}

export class WechatIssueService {
    public constructor(private readonly deps: WechatIssueServiceDeps) {}

    /** 列出某账号的批次：文章摘要一次取全后按批次分组，避免逐批次查询 */
    public list(accountId: string): WechatIssueSummary[] {
        this.requireAccount(accountId)
        const issues = listWechatIssues(this.deps.db, accountId)
        const articles = listWechatArticlesByIssues(
            this.deps.db,
            issues.map((issue) => issue.id),
        )
        const grouped = new Map<string, WechatArticleSummary[]>()
        for (const row of articles) {
            const list = grouped.get(row.issue_id) ?? []
            list.push(toArticleSummary(row))
            grouped.set(row.issue_id, list)
        }
        return issues.map((issue) => this.toIssueSummary(issue, grouped.get(issue.id) ?? []))
    }

    /** 新建空批次：标题缺省为「未命名批次 · 月-日」，用户随后在批次内添加文章 */
    public create(request: WechatIssueCreateRequest): WechatIssueCreateResult {
        this.requireAccount(request.accountId)
        const now = new Date()
        const fallbackTitle = `${DEFAULT_ISSUE_TITLE_PREFIX} ${String(now.getMonth() + 1)}-${String(now.getDate())}`
        const title = readWechatArticleTitle(request.title) || fallbackTitle
        const id = `iss-${randomUUID().replace(/-/g, '').slice(0, 10)}`
        insertWechatIssue(this.deps.db, {
            id,
            accountId: request.accountId,
            title: title.slice(0, WECHAT_ISSUE_TITLE_MAX),
            status: 'draft',
            createdAt: now.toISOString(),
        })
        const row = findWechatIssue(this.deps.db, id)
        if (row === null) {
            throw new Error('批次创建后未能读取，请重试')
        }
        return { issue: this.toIssueSummary(row, []) }
    }

    /** 批次详情：编辑弹窗据此回填正文 */
    public detail(id: string): WechatIssueDetailResult {
        const issue = this.requireIssue(id)
        const rows = listWechatArticles(this.deps.db, id)
        return {
            issue: this.toIssueSummary(issue, rows.map(toArticleSummary)),
            articles: rows.map(toArticleDetail),
        }
    }

    /** 删除批次：连同文章一并删除，不可撤销 */
    public remove(id: string): WechatIssueRemoveResult {
        this.requireIssue(id)
        deleteWechatIssue(this.deps.db, id)
        return { removed: true }
    }

    /** 手写文章：正文可为空（先占位再补写） */
    public createArticle(request: WechatArticleCreateRequest): WechatArticleCreateResult {
        const issue = this.requireIssue(request.issueId)
        this.assertArticleCapacity(issue.id)
        const body = request.body ?? ''
        this.assertBodyLength(body)
        const title = readWechatArticleTitle(request.title)
        if (title.length === 0) {
            throw new Error('文章标题不能为空')
        }
        const id = this.insertArticle({
            issueId: issue.id,
            title,
            author: readWechatArticleAuthor(request.author),
            digest: readWechatArticleDigest(request.digest),
            body,
            sourceKind: 'manual',
            sourcePath: null,
        })
        return { article: this.requireArticleDetail(id) }
    }

    /** 更新文章：来源不变，只改可编辑字段 */
    public updateArticle(request: WechatArticleUpdateRequest): WechatArticleUpdateResult {
        const existing = this.requireArticle(request.id)
        const title = readWechatArticleTitle(request.title)
        if (title.length === 0) {
            throw new Error('文章标题不能为空')
        }
        this.assertBodyLength(request.body)
        updateWechatArticle(this.deps.db, {
            id: existing.id,
            title,
            author: readWechatArticleAuthor(request.author) || null,
            digest: readWechatArticleDigest(request.digest) || null,
            body: request.body,
            bodyHash: contentHash(request.body),
            wordCount: countWords(request.body),
        })
        syncWechatIssueArticleCount(this.deps.db, existing.issue_id, new Date().toISOString())
        return { article: this.requireArticleDetail(existing.id) }
    }

    /** 删除文章并重排序号 */
    public removeArticle(id: string): WechatArticleRemoveResult {
        const existing = this.requireArticle(id)
        deleteWechatArticle(this.deps.db, id)
        syncWechatIssueArticleCount(this.deps.db, existing.issue_id, new Date().toISOString())
        return { removed: true }
    }

    /**
     * 从笔记或作品文档导入一篇：宿主弹选择器 → 校验归属 → 回查索引 → 读盘 → 建文章。
     * 关键约束：用户取消返回 imported: false，不视为错误；文档不在索引内时提示先让索引收录，
     * 因为标题与路径都以索引为准，避免读到索引外的任意文件。
     */
    public async importArticle(request: WechatArticleImportRequest): Promise<WechatArticleImportResult> {
        const issue = this.requireIssue(request.issueId)
        this.assertArticleCapacity(issue.id)

        const moduleDir = SOURCE_MODULE_DIRS[request.sourceKind]
        const root = resolveStorageRoot()
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: buildStorageUri(root, [moduleDir]),
            filters: { Markdown: ['md'] },
            openLabel: '导入到批次',
            title: request.sourceKind === 'note' ? '选择要导入的笔记' : '选择要导入的作品文档',
        })
        const [uri] = picked ?? []
        if (uri === undefined) {
            return { imported: false }
        }

        const relativePath = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/')
        if (relativePath.startsWith('..') || !relativePath.startsWith(`${moduleDir}/`)) {
            throw new Error(`只能导入 ${moduleDir}/ 目录下的 Markdown 文档`)
        }
        const indexed = findIndexedFile(this.deps.indexDb, relativePath)
        if (indexed === null) {
            throw new Error('该文档尚未被索引收录，请先保存并等待索引完成后重试')
        }

        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
        const { frontmatter, body } = splitFrontmatter(content)
        const title = parseTitle(body, frontmatter) || indexed.title
        const normalizedBody = stripLeadingHeading(body).trim()
        if (normalizedBody.length === 0) {
            throw new Error('该文档正文为空，无法导入')
        }
        this.assertBodyLength(normalizedBody)

        const id = this.insertArticle({
            issueId: issue.id,
            title: readWechatArticleTitle(title) || indexed.title,
            author: '',
            digest: '',
            body: normalizedBody,
            sourceKind: request.sourceKind,
            sourcePath: relativePath,
        })
        return { imported: true, article: this.requireArticleDetail(id) }
    }

    /** 插入文章并同步批次计数，返回新文章 id */
    private insertArticle(input: {
        issueId: string
        title: string
        author: string
        digest: string
        body: string
        sourceKind: 'manual' | 'note' | 'press'
        sourcePath: string | null
    }): string {
        const id = `art-${randomUUID().replace(/-/g, '').slice(0, 10)}`
        insertWechatArticle(this.deps.db, {
            id,
            issueId: input.issueId,
            title: input.title,
            author: input.author.length > 0 ? input.author : null,
            digest: input.digest.length > 0 ? input.digest : null,
            body: input.body,
            bodyHash: contentHash(input.body),
            wordCount: countWords(input.body),
            sourceKind: input.sourceKind,
            sourcePath: input.sourcePath,
        })
        syncWechatIssueArticleCount(this.deps.db, input.issueId, new Date().toISOString())
        return id
    }

    /** 行 → 批次摘要：文章数取实际条数，冗余列仅作校验外的兜底 */
    private toIssueSummary(issue: WechatIssueRow, articles: WechatArticleSummary[]): WechatIssueSummary {
        return {
            id: issue.id,
            accountId: issue.account_id,
            title: issue.title,
            status: readIssueStatus(issue.status),
            articleCount: articles.length,
            articles,
            updatedAt: issue.updated_at,
            ...(issue.scheduled_at === null ? {} : { scheduledAt: issue.scheduled_at }),
            ...(issue.published_at === null ? {} : { publishedAt: issue.published_at }),
            ...(issue.error_hint === null ? {} : { errorHint: issue.error_hint }),
        }
    }

    /** 校验账号存在：批次挂在账号下，账号被删后不能再建批次 */
    private requireAccount(accountId: string): void {
        if (findWechatAccount(this.deps.db, accountId) === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
    }

    /** 取批次行，不存在即抛错 */
    private requireIssue(id: string): WechatIssueRow {
        const row = findWechatIssue(this.deps.db, id)
        if (row === null) {
            throw new Error('推送批次不存在，可能已被删除')
        }
        return row
    }

    /** 取文章行，不存在即抛错 */
    private requireArticle(id: string): WechatArticleRow {
        const row = findWechatArticle(this.deps.db, id)
        if (row === null) {
            throw new Error('文章不存在，可能已被删除')
        }
        return row
    }

    /** 取文章详情（含正文），供写操作回传最新快照 */
    private requireArticleDetail(id: string): WechatArticleDetail {
        return toArticleDetail(this.requireArticle(id))
    }

    /** 校验批次容量：平台一次群发最多 8 篇 */
    private assertArticleCapacity(issueId: string): void {
        if (readWechatArticleCount(this.deps.db, issueId) >= WECHAT_ISSUE_ARTICLE_LIMIT) {
            throw new Error(`一次推送最多 ${String(WECHAT_ISSUE_ARTICLE_LIMIT)} 篇，请先移除一篇再添加`)
        }
    }

    /** 校验正文长度：超出公众号编辑器上限时提前阻断，避免推送阶段才发现 */
    private assertBodyLength(body: string): void {
        if (body.length > WECHAT_ARTICLE_BODY_MAX) {
            throw new Error(
                `正文 ${String(body.length)} 字，超过公众号 ${String(WECHAT_ARTICLE_BODY_MAX)} 字上限，请精简后再导入`,
            )
        }
    }
}
