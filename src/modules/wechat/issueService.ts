/**
 * 推送批次服务：批次与文章的增删改查、从笔记/作品文档导入，是公众号批次侧的唯一编排层。
 * 复用约定：落库走 db/issueRepository，正文文件读写走 ./issueDocument，源文档的元数据解析复用
 * common/db/fileMeta 的 splitFrontmatter / parseTitle / countWords / contentHash，
 * 路径构造与校验复用 common/storagePath 与 config。
 * 关键约束：批次最多 8 篇、正文最多 2 万字（平台上限），超出直接拒绝并给出可执行提示；
 * 新建与导入都先把正文写进批次目录（wechat/{appid}/post/{时间戳}/）再落库，发布只读文件，库内 body 只是镜像；
 * 文章文件与笔记同构——标题由正文首个一级标题承载、文件名跟随标题，库内 title 与 file_path 随之同步；
 * 导入不接收前端传入的路径——源文件由宿主弹出选择器、回查索引库后再读盘，从源头排除任意文件读取；
 * 任何增删文章的操作都要同步批次 article_count 与 updated_at，否则列表显示与实际不一致。
 */
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { countWords, contentHash, parseTitle, splitFrontmatter } from '@modules/common/db/fileMeta'
import { findIndexedFile } from '@modules/common/db/indexRepository'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
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
    type WechatArticleMetaRequest,
    type WechatArticleMoveRequest,
    type WechatArticleMoveResult,
    type WechatArticleOpenResult,
    type WechatArticleRemoveResult,
    type WechatArticleSummary,
    type WechatArticleUpdateRequest,
    type WechatArticleUpdateResult,
    type WechatCoverPickResult,
    type WechatIssueCreateRequest,
    type WechatIssueCreateResult,
    type WechatIssueDetailResult,
    type WechatIssueRemoveResult,
    type WechatIssuesMergeRequest,
    type WechatIssuesMergeResult,
    type WechatIssuesRemoveBatchResult,
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
    moveWechatArticlesToIssue,
    readWechatArticleCount,
    swapWechatArticleSortIndex,
    syncWechatIssueArticleCount,
    updateWechatArticle,
    updateWechatArticleFilePath,
    updateWechatArticleTitle,
    updateWechatIssueDirPath,
} from './db/issueRepository'
import {
    buildWechatArticleContent,
    buildWechatDocFileName,
    copyWechatArticleDoc,
    createWechatIssueDirectory,
    focusWechatArticleIfActive,
    readWechatArticleDoc,
    readWechatArticleForPublish,
    readWechatDirectoryNames,
    removeWechatArticleDoc,
    removeWechatIssueDirectory,
    renameWechatArticleDoc,
    stripLeadingHeading,
    writeWechatArticleDoc,
} from './issueDocument'
import type { WechatAccountRow } from './db/accountRepository'
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

/** 封面允许的扩展名：与素材上传口径保持一致，平台只接受 jpg/png */
const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

/** 批次标题缺省前缀：新建时拼上日期，用户随后可改 */
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

/** 收窄行内来源：脏数据按手写处理，避免前端拿到未知来源 */
function readArticleSourceKind(value: string): 'manual' | 'note' | 'press' {
    return value === 'note' || value === 'press' ? value : 'manual'
}

/** 行 → 文章摘要：列表不返回正文，只带字数、来源与批次内文件路径 */
function toArticleSummary(row: WechatArticleRow): WechatArticleSummary {
    return {
        id: row.id,
        sortIndex: row.sort_index,
        title: row.title,
        ...(row.author === null ? {} : { author: row.author }),
        ...(row.digest === null ? {} : { digest: row.digest }),
        sourceKind: readArticleSourceKind(row.source_kind),
        ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
        ...(row.file_path === null ? {} : { filePath: row.file_path }),
        ...(row.cover_path === null ? {} : { coverPath: row.cover_path }),
        allowComment: row.allow_comment === 1,
        wordCount: row.word_count,
    }
}

/** 行 → 文章详情：附带 Markdown 源文 */
function toArticleDetail(row: WechatArticleRow): WechatArticleDetail {
    return { ...toArticleSummary(row), body: row.body }
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

    /**
     * 新建空批次：标题缺省为「未命名批次 · 月-日」，同时按当前时分建好批次目录。
     * 关键约束：目录先落盘再写库，建目录失败时不会留下一个「有批次但没有目录」的空壳；
     * 账号还没有 AppID（只填了账号设置、没配密钥）时拒绝建批次——目录名就是 AppID，缺了无法定位。
     */
    public async create(request: WechatIssueCreateRequest): Promise<WechatIssueCreateResult> {
        const account = this.requireAccount(request.accountId)
        if (account.app_id.length === 0) {
            throw new Error('该账号还没有 AppID，请先在账号页的「密钥设置」里填写 AppID 与 AppSecret')
        }
        const now = new Date()
        const fallbackTitle = `${DEFAULT_ISSUE_TITLE_PREFIX} ${String(now.getMonth() + 1)}-${String(now.getDate())}`
        const title = readWechatArticleTitle(request.title) || fallbackTitle
        const id = `iss-${randomUUID().replace(/-/g, '').slice(0, 10)}`
        const dirPath = await createWechatIssueDirectory(resolveStorageRoot(), account.app_id, now)
        insertWechatIssue(this.deps.db, {
            id,
            accountId: request.accountId,
            title: title.slice(0, WECHAT_ISSUE_TITLE_MAX),
            status: 'draft',
            createdAt: now.toISOString(),
            dirPath,
        })
        const row = findWechatIssue(this.deps.db, id)
        if (row === null) {
            throw new Error('批次创建后未能读取，请重试')
        }
        return { issue: this.toIssueSummary(row, []) }
    }

    /**
     * 批次详情：编辑弹窗据此回填正文。
     * 关键约束：正文以批次文件为准——用户可能在编辑器里直接改过 md，
     * 若回填库内镜像，弹窗保存就会把文件改动覆盖掉；文件读不到时才退回镜像。
     */
    public async detail(id: string): Promise<WechatIssueDetailResult> {
        const issue = this.requireIssue(id)
        const rows = listWechatArticles(this.deps.db, id)
        const articles = await Promise.all(rows.map((row) => this.toArticleDetailFromFile(row)))
        return {
            issue: this.toIssueSummary(issue, rows.map(toArticleSummary)),
            articles,
        }
    }

    /**
     * 读取发布用标题与正文：只认批次目录里的 Markdown 文件，标题取正文首个一级标题。
     * 关键约束：没有文件路径的旧文章必须先在编辑器里保存一次，否则会发出与文件不一致的内容；
     * 文件标题与库内不一致时以文件为准并回写库，保证列表展示与发布结果同源。
     */
    public async readArticleContent(article: WechatArticleRow): Promise<{ title: string; body: string }> {
        if (article.file_path === null || article.file_path.length === 0) {
            throw new Error(`《${article.title}》还没有批次正文文件，请打开文章保存一次后再发布`)
        }
        const doc = await readWechatArticleForPublish(resolveStorageRoot(), article.file_path, article.title)
        if (doc.title !== article.title) {
            updateWechatArticleTitle(this.deps.db, article.id, doc.title)
        }
        return doc
    }

    /**
     * 删除批次：连同文章与批次目录一并删除，不可撤销。
     * 关键约束：先删库再删目录——目录删不掉只留一份残留文件，不至于出现「目录没了但批次还在」。
     */
    public async remove(id: string): Promise<WechatIssueRemoveResult> {
        const issue = this.requireIssue(id)
        deleteWechatIssue(this.deps.db, id)
        await this.removeIssueDirectory(issue)
        return { removed: true }
    }

    /**
     * 批量删除批次：只允许草稿与推送失败两条状态。
     * 关键约束：先整体校验再删——部分成功会让用户不知道哪几个没删掉；
     * 已推送的必须去平台后台删（本地删了平台还在，反而更难核对），推送中的同理拒绝。
     */
    public async removeMany(ids: string[]): Promise<WechatIssuesRemoveBatchResult> {
        const blocked: string[] = []
        const removable: WechatIssueRow[] = []
        for (const id of ids) {
            const row = findWechatIssue(this.deps.db, id)
            if (row === null) {
                blocked.push('已被删除的批次')
                continue
            }
            if (row.status !== 'draft' && row.status !== 'failed') {
                blocked.push(`《${row.title}》`)
                continue
            }
            removable.push(row)
        }
        if (blocked.length > 0) {
            throw new Error(`只能删除草稿或推送失败的批次，以下批次不可删除：${blocked.join('、')}`)
        }
        // 单个 deleteWechatIssue 内部已按批次开事务（同事务删掉文章），这里逐条调用即可
        for (const row of removable) {
            deleteWechatIssue(this.deps.db, row.id)
            await this.removeIssueDirectory(row)
        }
        return { removed: removable.length }
    }

    /**
     * 合并批次：把源批次的文章并入目标批次，随后删除空掉的源批次。
     * 关键约束：只允许合并草稿——已生成草稿的批次内容已进平台草稿箱，再往里加文章会让本地与平台不一致；
     * 先整体校验（存在、状态、篇数上限）再在一个事务里搬文章并删源批次，避免「搬了一半」；
     * 顺序号接在目标批次末尾：微信侧 articles 顺序就是推送顺序，直接沿用源批次原序号会打乱目标顺序。
     */
    public async merge(request: WechatIssuesMergeRequest): Promise<WechatIssuesMergeResult> {
        const target = findWechatIssue(this.deps.db, request.targetId)
        if (target === null) {
            throw new Error('目标批次不存在，可能已被删除')
        }
        if (target.status !== 'draft') {
            throw new Error('只能并入草稿状态的批次：草稿已就绪的批次内容已经进了平台草稿箱')
        }

        const sources = request.ids.map((id) => {
            const row = findWechatIssue(this.deps.db, id)
            if (row === null) {
                throw new Error('部分批次已被删除，请刷新后重试')
            }
            if (row.status !== 'draft') {
                throw new Error(`《${row.title}》不是草稿状态，不能合并`)
            }
            return row
        })

        const targetCount = listWechatArticles(this.deps.db, target.id).length
        const movedCount = sources.reduce((sum, row) => sum + listWechatArticles(this.deps.db, row.id).length, 0)
        if (movedCount === 0) {
            throw new Error('所选批次里没有文章，无需合并')
        }
        if (targetCount + movedCount > WECHAT_ISSUE_ARTICLE_LIMIT) {
            throw new Error(
                `合并后共 ${String(targetCount + movedCount)} 篇，超过单次群发 ${String(WECHAT_ISSUE_ARTICLE_LIMIT)} 篇上限`,
            )
        }

        /**
         * 文件先搬到目标批次目录、再搬库、最后删源文件：
         * 事务失败时源批次与源文件都还在，目标目录最多留一份没人引用的副本。
         */
        const root = resolveStorageRoot()
        const targetDir = await this.ensureIssueDirectory(target)
        const taken = await readWechatDirectoryNames(root, targetDir)
        const movedFiles: { id: string; fromPath: string; toPath: string }[] = []
        for (const row of sources) {
            for (const article of listWechatArticles(this.deps.db, row.id)) {
                if (article.file_path === null || article.file_path.length === 0) {
                    continue
                }
                const fileName = buildWechatDocFileName(article.title, taken)
                taken.add(fileName.toLowerCase())
                const toPath = await copyWechatArticleDoc(root, article.file_path, targetDir, fileName)
                movedFiles.push({ id: article.id, fromPath: article.file_path, toPath })
            }
        }

        const now = new Date().toISOString()
        this.deps.db.transaction(() => {
            let cursor = targetCount
            for (const row of sources) {
                const count = listWechatArticles(this.deps.db, row.id).length
                moveWechatArticlesToIssue(this.deps.db, row.id, target.id, cursor + 1)
                cursor += count
                deleteWechatIssue(this.deps.db, row.id)
            }
            for (const item of movedFiles) {
                updateWechatArticleFilePath(this.deps.db, item.id, item.toPath)
            }
            syncWechatIssueArticleCount(this.deps.db, target.id, now)
        })()

        for (const item of movedFiles) {
            await removeWechatArticleDoc(root, item.fromPath)
        }
        for (const row of sources) {
            await this.removeIssueDirectory(row)
        }

        const detail = await this.detail(target.id)
        return { issue: detail.issue, movedCount }
    }

    /**
     * 手写文章：正文可为空（先占位再补写）。
     * 关键约束：先按标题在批次目录建好 md 文件，再落库；文件写不进去就不留一条「没有正文文件」的记录。
     */
    public async createArticle(request: WechatArticleCreateRequest): Promise<WechatArticleCreateResult> {
        const issue = this.requireIssue(request.issueId)
        this.assertArticleCapacity(issue.id)
        const body = request.body ?? ''
        this.assertBodyLength(body)
        const title = readWechatArticleTitle(request.title)
        if (title.length === 0) {
            throw new Error('文章标题不能为空')
        }
        const author = readWechatArticleAuthor(request.author)
        const digest = readWechatArticleDigest(request.digest)
        const coverPath = this.readCoverPath(request.coverPath)
        const allowComment = request.allowComment === true ? 1 : 0
        const filePath = await this.allocateArticleFilePath(issue, title)
        await this.writeArticleDoc({ filePath, title, body })
        const id = this.insertArticle({
            issueId: issue.id,
            title,
            author,
            digest,
            body,
            coverPath,
            allowComment,
            sourceKind: 'manual',
            sourcePath: null,
            filePath,
        })
        return { article: this.requireArticleDetail(id) }
    }

    /**
     * 快速新建：宿主取「未命名文章 N」默认标题、空正文，建好文件后直接打开编辑器。
     * 关键约束：标题、作者、封面等元信息不在这一步询问，之后在工作流面板逐篇设置；
     * 打开失败不影响创建（文章与文件都已就绪），错误由 openArticle 内部提示。
     */
    public async quickCreateArticle(issueId: string): Promise<WechatArticleCreateResult> {
        const issue = this.requireIssue(issueId)
        const created = await this.createArticle({
            issueId: issue.id,
            title: `未命名文章 ${String(readWechatArticleCount(this.deps.db, issue.id) + 1)}`,
        })
        await this.openArticle(created.article.id)
        return created
    }

    /**
     * 打开正文文件：旧文章没有文件或文件被删时，先按当前元信息与库内正文补建再打开。
     * 关键约束：补建只发生在文件缺失时，已有文件一律原样打开，不覆盖编辑器里的改动。
     */
    public async openArticle(id: string): Promise<WechatArticleOpenResult> {
        const article = this.requireArticle(id)
        const filePath = await this.ensureArticleFile(article)
        const uri = buildStorageUri(resolveStorageRoot(), toSafeSegments(filePath, '文章'))
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document, { preview: false })
        return { opened: true }
    }

    /**
     * 更新文章：来源不变，只改可编辑字段。
     * 关键约束：新内容先写进批次文件再改库——写盘失败时库里仍是上一次能发布的内容；
     * 旧文章（没有文件路径）在首次保存时补建文件，文件名沿用当前标题。
     */
    public async updateArticle(request: WechatArticleUpdateRequest): Promise<WechatArticleUpdateResult> {
        const existing = this.requireArticle(request.id)
        const title = readWechatArticleTitle(request.title)
        if (title.length === 0) {
            throw new Error('文章标题不能为空')
        }
        this.assertBodyLength(request.body)
        const author = readWechatArticleAuthor(request.author) || null
        const digest = readWechatArticleDigest(request.digest) || null
        const coverPath = request.coverPath === undefined ? existing.cover_path : this.readCoverPath(request.coverPath)
        const allowComment = request.allowComment === undefined ? existing.allow_comment : request.allowComment ? 1 : 0
        const initialPath =
            existing.file_path ?? (await this.allocateArticleFilePath(this.requireIssue(existing.issue_id), title))
        await this.writeArticleDoc({ filePath: initialPath, title, body: request.body })
        const filePath = await this.renameArticleFile(initialPath, title)
        if (filePath !== initialPath) {
            await focusWechatArticleIfActive(resolveStorageRoot(), initialPath, filePath)
        }
        updateWechatArticle(this.deps.db, {
            id: existing.id,
            title,
            author,
            digest,
            body: request.body,
            bodyHash: contentHash(request.body),
            wordCount: countWords(request.body),
            coverPath,
            allowComment,
            filePath,
        })
        syncWechatIssueArticleCount(this.deps.db, existing.issue_id, new Date().toISOString())
        return { article: this.requireArticleDetail(existing.id) }
    }

    /**
     * 只改元信息：标题、作者、摘要、封面与留言开关（工作流面板的文章设置）。
     * 关键约束：正文以批次文件为准，改标题时把文件里的正文原样保留并重写一级标题，
     * 随后让文件名跟随标题；用库内镜像写回会覆盖用户在编辑器里的改动，文件缺失时先按镜像补建。
     */
    public async updateArticleMeta(request: WechatArticleMetaRequest): Promise<WechatArticleUpdateResult> {
        const existing = this.requireArticle(request.id)
        const title = readWechatArticleTitle(request.title)
        if (title.length === 0) {
            throw new Error('文章标题不能为空')
        }
        const author = readWechatArticleAuthor(request.author) || null
        const digest = readWechatArticleDigest(request.digest) || null
        const coverPath = request.coverPath === undefined ? existing.cover_path : this.readCoverPath(request.coverPath)
        const allowComment = request.allowComment === undefined ? existing.allow_comment : request.allowComment ? 1 : 0
        const currentPath = await this.ensureArticleFile(existing)
        const doc = await readWechatArticleDoc(resolveStorageRoot(), currentPath)
        const body = doc === null ? existing.body : doc.body
        this.assertBodyLength(body)
        await this.writeArticleDoc({ filePath: currentPath, title, body })
        const filePath = await this.renameArticleFile(currentPath, title)
        if (filePath !== currentPath) {
            await focusWechatArticleIfActive(resolveStorageRoot(), currentPath, filePath)
        }
        updateWechatArticle(this.deps.db, {
            id: existing.id,
            title,
            author,
            digest,
            // 正文取文件内容：文件为空时镜像同步清空，与「发布只认文件」保持同一口径
            body,
            bodyHash: contentHash(body),
            wordCount: countWords(body),
            coverPath,
            allowComment,
            filePath,
        })
        syncWechatIssueArticleCount(this.deps.db, existing.issue_id, new Date().toISOString())
        return { article: this.requireArticleDetail(existing.id) }
    }

    /**
     * 调整文章顺序：顺序号即推送顺序，上移/下移只与相邻一篇交换。
     * 关键约束：已推送或推送中的批次拒绝调序（内容已固定）；首项上移、末项下移也拒绝，
     * 前端虽已置灰，宿主仍需自校验，避免绕过界面直接调用时写出重复序号。
     */
    public moveArticle(request: WechatArticleMoveRequest): WechatArticleMoveResult {
        const article = this.requireArticle(request.id)
        const issue = this.requireIssue(article.issue_id)
        if (issue.status === 'published' || issue.status === 'pushing') {
            throw new Error('已推送或推送中的批次不能再调整文章顺序')
        }
        const articles = listWechatArticles(this.deps.db, issue.id)
        const index = articles.findIndex((item) => item.id === article.id)
        if (index < 0) {
            throw new Error('文章已不在该批次，请刷新后重试')
        }
        const target = request.direction === 'up' ? index - 1 : index + 1
        if (target < 0) {
            throw new Error('已经是第一篇，无法上移')
        }
        if (target >= articles.length) {
            throw new Error('已经是最后一篇，无法下移')
        }
        const neighbor = articles[target]
        if (neighbor === undefined) {
            throw new Error('相邻文章不存在，请刷新后重试')
        }
        swapWechatArticleSortIndex(this.deps.db, article.id, neighbor.id)
        syncWechatIssueArticleCount(this.deps.db, issue.id, new Date().toISOString())
        return { moved: true }
    }

    /**
     * 删除文章：先删批次文件再删库，文件删不掉时不改库，避免留下无主正文。
     * 关键约束：删除后重排剩余序号（1..n），因此删掉第一篇时原第二篇顺延顶上主图位。
     */
    public async removeArticle(id: string): Promise<WechatArticleRemoveResult> {
        const existing = this.requireArticle(id)
        if (existing.file_path !== null && existing.file_path.length > 0) {
            await removeWechatArticleDoc(resolveStorageRoot(), existing.file_path)
        }
        deleteWechatArticle(this.deps.db, id)
        syncWechatIssueArticleCount(this.deps.db, existing.issue_id, new Date().toISOString())
        return { removed: true }
    }

    /**
     * 选择封面图：宿主弹选择器并返回存储根相对路径，前端不传路径。
     * 关键约束：只接受存储根内的 jpg/png；用户取消返回 null 而不是抛错。
     */
    public async pickCover(): Promise<WechatCoverPickResult> {
        const root = resolveStorageRoot()
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: buildStorageUri(root, ['images']),
            filters: { 图片: ['png', 'jpg', 'jpeg'] },
            openLabel: '设为封面',
            title: '选择封面图',
        })
        const [uri] = picked ?? []
        if (uri === undefined) {
            return { path: null }
        }
        const relativePath = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/')
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new Error('封面图必须在文档保存目录内')
        }
        if (!COVER_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase())) {
            throw new Error('封面只支持 jpg / png')
        }
        return { path: relativePath }
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
        const title = readWechatArticleTitle(parseTitle(body, frontmatter)) || indexed.title
        const normalizedBody = stripLeadingHeading(body).trim()
        if (normalizedBody.length === 0) {
            throw new Error('该文档正文为空，无法导入')
        }
        this.assertBodyLength(normalizedBody)

        /**
         * 复制而不是引用源文档：批次目录里的副本才是可改写的发布稿，
         * 之后在弹窗里的二次编辑只影响副本，源笔记/作品保持原样。
         */
        const filePath = await this.allocateArticleFilePath(issue, title)
        await this.writeArticleDoc({ filePath, title, body: normalizedBody })
        const id = this.insertArticle({
            issueId: issue.id,
            title,
            author: '',
            digest: '',
            body: normalizedBody,
            coverPath: null,
            allowComment: 0,
            sourceKind: request.sourceKind,
            sourcePath: relativePath,
            filePath,
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
        coverPath: string | null
        allowComment: number
        sourceKind: 'manual' | 'note' | 'press'
        sourcePath: string | null
        filePath: string
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
            coverPath: input.coverPath,
            allowComment: input.allowComment,
            sourceKind: input.sourceKind,
            sourcePath: input.sourcePath,
            filePath: input.filePath,
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
    private requireAccount(accountId: string): WechatAccountRow {
        const row = findWechatAccount(this.deps.db, accountId)
        if (row === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
        return row
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

    /** 行 → 详情：有批次文件时用文件正文覆盖镜像，文件缺失或不可读时沿用镜像 */
    private async toArticleDetailFromFile(row: WechatArticleRow): Promise<WechatArticleDetail> {
        const detail = toArticleDetail(row)
        if (row.file_path === null || row.file_path.length === 0) {
            return detail
        }
        const doc = await readWechatArticleDoc(resolveStorageRoot(), row.file_path)
        return doc === null ? detail : { ...detail, body: doc.body }
    }

    /** 校验批次容量：平台一次群发最多 8 篇 */
    private assertArticleCapacity(issueId: string): void {
        if (readWechatArticleCount(this.deps.db, issueId) >= WECHAT_ISSUE_ARTICLE_LIMIT) {
            throw new Error(`一次推送最多 ${String(WECHAT_ISSUE_ARTICLE_LIMIT)} 篇，请先移除一篇再添加`)
        }
    }

    /**
     * 规整封面路径：空串视为清除（返回 null），其余只做扩展名与相对形式检查。
     * 关键约束：绝对路径放行，由素材服务在推送时统一做「是否落在存储根内」的最终校验。
     */
    private readCoverPath(value: string | undefined): string | null {
        const trimmed = value?.trim() ?? ''
        if (trimmed.length === 0) {
            return null
        }
        if (!COVER_EXTENSIONS.has(path.extname(trimmed).toLowerCase())) {
            throw new Error('封面只支持 jpg / png')
        }
        return path.isAbsolute(trimmed) ? trimmed : trimmed.replace(/^\.\//, '')
    }

    /** 校验正文长度：超出公众号编辑器上限时提前阻断，避免推送阶段才发现 */
    private assertBodyLength(body: string): void {
        if (body.length > WECHAT_ARTICLE_BODY_MAX) {
            throw new Error(
                `正文 ${String(body.length)} 字，超过公众号 ${String(WECHAT_ARTICLE_BODY_MAX)} 字上限，请精简后再导入`,
            )
        }
    }

    /**
     * 取批次目录：旧批次（建库时还没有目录）按创建时间补建并回写，
     * 保证同一批次的所有正文文件始终落在同一个目录里。
     */
    private async ensureIssueDirectory(issue: WechatIssueRow): Promise<string> {
        if (issue.dir_path !== null && issue.dir_path.length > 0) {
            return issue.dir_path
        }
        const account = this.requireAccount(issue.account_id)
        const createdAt = new Date(issue.updated_at)
        const now = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
        const dirPath = await createWechatIssueDirectory(resolveStorageRoot(), account.app_id, now)
        updateWechatIssueDirPath(this.deps.db, issue.id, dirPath)
        return dirPath
    }

    /** 分配文章文件路径：标题转文件名，目录内同名时追加序号 */
    private async allocateArticleFilePath(issue: WechatIssueRow, title: string): Promise<string> {
        const root = resolveStorageRoot()
        const dirPath = await this.ensureIssueDirectory(issue)
        const taken = await readWechatDirectoryNames(root, dirPath)
        return `${dirPath}/${buildWechatDocFileName(title, taken)}`
    }

    /** 行 → 落盘字段：文件只有标题与正文，元信息留在库里 */
    private toDocInput(row: WechatArticleRow): { title: string; body: string } {
        return { title: row.title, body: row.body }
    }

    /**
     * 确保正文文件存在：旧文章没有路径或文件被删时按当前元信息补建并回写路径。
     * 关键约束：文件已存在时原样返回，绝不覆盖——用户可能正在编辑器里改它。
     */
    private async ensureArticleFile(article: WechatArticleRow): Promise<string> {
        const root = resolveStorageRoot()
        if (article.file_path !== null && article.file_path.length > 0) {
            const existing = await readWechatArticleDoc(root, article.file_path)
            if (existing !== null) {
                return article.file_path
            }
            await this.writeArticleDoc({ ...this.toDocInput(article), filePath: article.file_path })
            return article.file_path
        }
        const filePath = await this.allocateArticleFilePath(this.requireIssue(article.issue_id), article.title)
        await this.writeArticleDoc({ ...this.toDocInput(article), filePath })
        updateWechatArticleFilePath(this.deps.db, article.id, filePath)
        return filePath
    }

    /** 落盘正文：文件只有一级标题与正文（与笔记同构），写盘失败直接抛错由调用方中止入库 */
    private async writeArticleDoc(input: { filePath: string; title: string; body: string }): Promise<void> {
        await writeWechatArticleDoc(
            resolveStorageRoot(),
            input.filePath,
            buildWechatArticleContent(input.title, input.body),
        )
    }

    /**
     * 让文件名跟随标题：同目录内重名按笔记口径顺延「标题 2」，返回最终路径。
     * 关键约束：比较忽略大小写，取目录清单时先剔除自身，避免把自己当成占用者。
     */
    private async renameArticleFile(filePath: string, title: string): Promise<string> {
        const separator = filePath.lastIndexOf('/')
        if (separator <= 0) {
            return filePath
        }
        const root = resolveStorageRoot()
        const dirPath = filePath.slice(0, separator)
        const currentName = filePath.slice(separator + 1)
        const taken = await readWechatDirectoryNames(root, dirPath)
        taken.delete(currentName.toLowerCase())
        const fileName = buildWechatDocFileName(title, taken)
        if (fileName.toLowerCase() === currentName.toLowerCase()) {
            return filePath
        }
        const targetPath = `${dirPath}/${fileName}`
        await renameWechatArticleDoc(root, filePath, targetPath)
        return targetPath
    }

    /** 删除批次目录：库已删，目录删不掉只记日志，不影响后续操作 */
    private async removeIssueDirectory(issue: WechatIssueRow): Promise<void> {
        if (issue.dir_path === null || issue.dir_path.length === 0) {
            return
        }
        await removeWechatIssueDirectory(resolveStorageRoot(), issue.dir_path)
    }
}
