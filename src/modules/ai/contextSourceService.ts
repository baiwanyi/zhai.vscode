/**
 * 上下文来源服务：「添加上下文」菜单的来源列举、分页查询与批量添加。
 * 复用约定：索引类候选走 common/db 的 listFilesByPrefix，人物与大纲的分节由 press/docSections 提供行区间；
 * 添加统一交给 chatService.addContexts，去重、条数上限与截断标记不在此复制。
 * 关键约束：来源 id 与路径一律先经片段校验再拼绝对路径，前端只回传宿主产生过的 id；
 * 关键词只参与标题与路径的包含匹配，不做全文检索（索引的 FTS 只覆盖标题、标签与摘要）。
 */
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { findIndexedFile, listFilesByPrefix } from '@modules/common/db/indexRepository'
import {
    NOTE_PATH_PREFIX,
    UNCLASSIFIED_NOTEBOOK_DIR,
    UNCLASSIFIED_NOTEBOOK_ID,
} from '@modules/common/db/statsRepository'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { toSafeSegments } from '@modules/common/storagePath'
import { PRESS_DOC_FILE_NAMES, readCharacterSectionFacts, readDocSections } from '@modules/press/docSections'
import type {
    AiContextAddItem,
    AiContextAddResult,
    AiContextItem,
    AiContextItemKind,
    AiContextQueryRequest,
    AiContextQueryResult,
    AiContextScope,
    AiContextSource,
    AiContextSourceScope,
} from '@shared/types/aiChat'
import type { PressDocKey } from '@shared/types/press'
import { WECHAT_MODULE_DIR } from '@shared/types/wechat'
import { toErrorText } from '@shared/utils/error'
import { MAX_CONTEXT_CHARS } from './contextRefs'
import type { AiChatService } from './chatService'
import type { HostContextRef } from './contextRefs'
import type { NotebookPackService } from './notebookPackService'
import type Database from 'better-sqlite3'

/** 单次查询默认条数与上限：与「最近 20 条 + 滚动加载」的交互一致 */
const QUERY_LIMIT_DEFAULT = 20
const QUERY_LIMIT_MAX = 50

/** 公众号目录段形态：目录名即平台 AppID，只允许字母数字与下划线、短横线 */
const APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 章节目录名：与 projectFactory 的 Chapters 保持一致 */
const CHAPTER_DIR = 'Chapters'

/** 分节类内容与文档键的对应：人物取角色设定，大纲取大纲 */
const SECTION_DOCS: Readonly<Record<'character' | 'outline', PressDocKey>> = {
    character: 'characters',
    outline: 'outline',
}

/** 公众号账号：目录段用 AppID，展示用账号名 */
export interface ContextSourceAccount {
    appId: string
    name: string
}

export class ContextSourceService {
    public constructor(
        private readonly db: Database.Database,
        private readonly chat: AiChatService,
        private readonly notebookPack: NotebookPackService,
    ) {}

    /** 列举来源：笔记本、公众号与作品，作为菜单的筛选维度而非引用单位 */
    public listSources(scope: AiContextSourceScope, accounts: readonly ContextSourceAccount[] = []): AiContextSource[] {
        switch (scope) {
            case 'notebook':
                return this.listNotebookSources()
            case 'project':
                return this.listProjectSources()
            case 'account':
                return this.listAccountSources(accounts)
        }
    }

    /**
     * 分页查询候选：keyword 为空即按最近更新倒序，非空按标题与路径包含匹配。
     * 人物与大纲走文档分节（标题即条目名），其余走索引路径前缀。
     */
    public async query(
        request: AiContextQueryRequest,
        accounts: readonly ContextSourceAccount[] = [],
    ): Promise<AiContextQueryResult> {
        const limit = Math.min(Math.max(Math.trunc(request.limit ?? QUERY_LIMIT_DEFAULT), 1), QUERY_LIMIT_MAX)
        const offset = Math.max(Math.trunc(request.offset ?? 0), 0)
        if (request.kind === 'character' || request.kind === 'outline') {
            return this.querySections(request.kind, request, limit, offset)
        }
        return this.queryIndexed(request, accounts, limit, offset)
    }

    /**
     * 批量添加：逐项构造引用，单条失败只记入 failed 而不中断整批。
     * 关键约束：整篇引用不改字数（发送时统计），带行范围时读一次原文校验行号并算字数。
     */
    public async addContexts(
        items: readonly AiContextAddItem[],
        scope: AiContextScope = 'chat',
    ): Promise<AiContextAddResult> {
        const refs: HostContextRef[] = []
        const failed: { path: string; reason: string }[] = []
        for (const item of items) {
            try {
                refs.push(await this.createContextRef(item))
            } catch (cause) {
                failed.push({ path: item.path, reason: toErrorText(cause) })
            }
        }
        if (refs.length === 0) {
            return { added: 0, duplicated: 0, failed, isFull: false }
        }
        const result = this.chat.addContexts(refs, scope)
        return { added: result.added.length, duplicated: result.duplicated, failed, isFull: result.isFull }
    }

    /** 索引类候选：前缀 + 可选包含条件收窄，取 limit + 1 条判断是否还有下一批 */
    private queryIndexed(
        request: AiContextQueryRequest,
        accounts: readonly ContextSourceAccount[],
        limit: number,
        offset: number,
    ): AiContextQueryResult {
        const prefix = this.resolveIndexPrefix(request)
        const rows = listFilesByPrefix(this.db, prefix, {
            keyword: request.keyword ?? '',
            contains: request.kind === 'article' ? '/post/' : '',
            offset,
            limit: limit + 1,
        })
        const items: AiContextItem[] = rows.slice(0, limit).map((row) => ({
            path: row.path,
            title: row.title.length > 0 ? row.title : this.readBaseName(row.path),
            kind: request.kind,
            subtitle: this.readSubtitle(request.kind, row.path, accounts),
            charCount: row.wordCount,
            updatedAt: row.mtime,
        }))
        return { items, hasMore: rows.length > limit }
    }

    /** 分节类候选：人物只取二级标题（角色名），大纲连卷与章节一起返回 */
    private async querySections(
        kind: 'character' | 'outline',
        request: AiContextQueryRequest,
        limit: number,
        offset: number,
    ): Promise<AiContextQueryResult> {
        const dirPath = this.readProjectDir(request.sourceId)
        const doc = SECTION_DOCS[kind]
        const sections = await readDocSections(dirPath, doc)
        const keyword = (request.keyword ?? '').trim().toLowerCase()
        const matched = sections.filter((section) => {
            const isVisible = kind === 'outline' || section.level === 2
            const isHit = keyword.length === 0 || section.title.toLowerCase().includes(keyword)
            return isVisible && isHit
        })
        const docPath = `${dirPath}/${PRESS_DOC_FILE_NAMES[doc]}`
        // 人物卡额外带性别与角色分类：候选面板据此渲染性别图标与角色徽标
        const facts = kind === 'character' ? await readCharacterSectionFacts(dirPath) : []
        const factsByStartLine = new Map(facts.map((fact) => [fact.startLine, fact]))
        const items: AiContextItem[] = matched.slice(offset, offset + limit).map((section) => {
            const item: AiContextItem = {
                path: docPath,
                title: section.title,
                kind,
                subtitle: dirPath.slice(PRESS_MODULE_DIR.length + 1),
                startLine: section.startLine,
                endLine: section.endLine,
                charCount: section.charCount,
            }
            const fact = factsByStartLine.get(section.startLine)
            if (fact === undefined) {
                return item
            }
            return { ...item, genderLabel: fact.genderLabel, roleLabel: fact.roleLabel }
        })
        return { items, hasMore: matched.length > offset + limit }
    }

    /** 索引前缀：笔记按笔记本收窄，文章按公众号收窄，章节固定落在作品的 Chapters 目录 */
    private resolveIndexPrefix(request: AiContextQueryRequest): string {
        switch (request.kind) {
            case 'note': {
                if (request.sourceId === undefined) {
                    return NOTE_PATH_PREFIX
                }
                return `${this.readNotebookId(request.sourceId)}/`
            }
            case 'article': {
                if (request.sourceId === undefined) {
                    return `${WECHAT_MODULE_DIR}/`
                }
                return `${WECHAT_MODULE_DIR}/${this.readAppId(request.sourceId)}/post/`
            }
            case 'chapter': {
                return `${this.readProjectDir(request.sourceId)}/${CHAPTER_DIR}/`
            }
            default:
                throw new Error(`不支持按索引列举的内容分类：${String(request.kind)}`)
        }
    }

    /** 笔记本来源：把散落文档与「未分类」目录合并成一项，与工作台口径一致 */
    private listNotebookSources(): AiContextSource[] {
        const rows = this.db
            .prepare(
                `SELECT name, COUNT(*) AS count FROM (
                    SELECT CASE WHEN instr(substr(path, ?), '/') > 0
                                THEN substr(path, ?, instr(substr(path, ?), '/') - 1)
                                ELSE '' END AS name
                    FROM files
                    WHERE substr(path, 1, ?) = ?
                ) GROUP BY name`,
            )
            .all(
                NOTE_PATH_PREFIX.length + 1,
                NOTE_PATH_PREFIX.length + 1,
                NOTE_PATH_PREFIX.length + 1,
                NOTE_PATH_PREFIX.length,
                NOTE_PATH_PREFIX,
            ) as Array<{ name: string; count: number }>
        const merged = new Map<string, number>()
        for (const row of rows) {
            const isUnclassified = row.name.length === 0 || row.name === UNCLASSIFIED_NOTEBOOK_DIR
            const id = isUnclassified ? UNCLASSIFIED_NOTEBOOK_ID : `${NOTE_PATH_PREFIX}${row.name}`
            merged.set(id, (merged.get(id) ?? 0) + row.count)
        }
        return [...merged.entries()]
            .map(([id, count]) => ({ id, name: id.slice(NOTE_PATH_PREFIX.length), count }))
            .sort((left, right) => right.count - left.count)
    }

    /** 作品来源：press/ 下一级目录即作品，素材与快照目录已被索引排除 */
    private listProjectSources(): AiContextSource[] {
        const prefix = `${PRESS_MODULE_DIR}/`
        const rows = this.db
            .prepare(
                `SELECT name, COUNT(*) AS count FROM (
                    SELECT substr(path, ?, instr(substr(path, ?), '/') - 1) AS name
                    FROM files
                    WHERE substr(path, 1, ?) = ? AND instr(substr(path, ?), '/') > 0
                ) GROUP BY name ORDER BY count DESC`,
            )
            .all(prefix.length + 1, prefix.length + 1, prefix.length, prefix, prefix.length + 1) as Array<{
            name: string
            count: number
        }>
        return rows
            .filter((row) => row.name.length > 0)
            .map((row) => ({ id: `${prefix}${row.name}`, name: row.name, count: row.count }))
    }

    /** 公众号来源：目录段是 AppID，缺凭证的账号不会落到磁盘，计数自然为 0 */
    private listAccountSources(accounts: readonly ContextSourceAccount[]): AiContextSource[] {
        return accounts
            .filter((account) => APP_ID_PATTERN.test(account.appId))
            .map((account) => ({
                id: account.appId,
                name: account.name,
                count: this.countByPrefix(`${WECHAT_MODULE_DIR}/${account.appId}/post/`),
            }))
    }

    /** 按路径前缀统计条数 */
    private countByPrefix(prefix: string): number {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM files WHERE substr(path, 1, ?) = ?')
            .get(prefix.length, prefix) as { count: number } | undefined
        return row?.count ?? 0
    }

    /** 候选的辅助信息：笔记显示笔记本名，文章显示公众号名，章节显示作品名 */
    private readSubtitle(
        kind: AiContextItemKind,
        path: string,
        accounts: readonly ContextSourceAccount[],
    ): string | undefined {
        const segments = path.split('/')
        if (kind === 'note') {
            return segments.length > 2 ? segments[1] : undefined
        }
        if (kind === 'article') {
            const appId = segments[1] ?? ''
            return accounts.find((account) => account.appId === appId)?.name
        }
        if (kind === 'chapter') {
            return segments[1]
        }
        return undefined
    }

    /** 展示标题的回退：索引标题为空时用文件名主干 */
    private readBaseName(path: string): string {
        const fileName = path.slice(path.lastIndexOf('/') + 1)
        return fileName.replace(/\.md$/u, '')
    }

    /**
     * 构造单条引用：路径必须落在索引内，或确实存在于存储根（覆盖索引尚未收录的骨架文档）。
     * 安全约束：先 toSafeSegments 校验，再拼绝对路径，杜绝 `..` 与盘符逃逸。
     */
    private async createContextRef(item: AiContextAddItem): Promise<HostContextRef> {
        const segments = toSafeSegments(item.path, '上下文路径')
        const relativePath = segments.join('/')
        const uri = vscode.Uri.joinPath(resolveStorageRoot(), ...segments)
        // 笔记本是目录而不是文件：路径形如 notes/<单段> 且不带 .md 后缀，走整本打包
        const isNotebook =
            segments.length === 2 && segments[0] === NOTE_PATH_PREFIX.slice(0, -1) && !item.path.endsWith('.md')
        if (isNotebook) {
            // 整本放不进全文档位（节选 / 目录）即视为超限：先自动压缩，再取压缩后的打包结果
            let packed = await this.notebookPack.pack(relativePath)
            if (packed === null) {
                throw new Error('该笔记本暂无笔记')
            }
            if (packed.packMode !== 'full' && packed.packMode !== 'compressed') {
                try {
                    await this.chat.compressNotebook(relativePath)
                    const compressed = await this.notebookPack.pack(relativePath)
                    if (compressed !== null) {
                        packed = compressed
                    }
                } catch (cause) {
                    // 压缩失败保留当前档位（节选 / 目录）：一次模型调用失败不该挡住添加
                    logger.warn(`笔记本自动压缩失败，回退打包原文：${toErrorText(cause)}`)
                }
            }
            return {
                id: randomUUID(),
                kind: 'notebook',
                label: `${relativePath}（${String(packed.memberCount)} 篇）`,
                displayPath: relativePath,
                startLine: null,
                endLine: null,
                charCount: packed.charCount,
                isTruncated: packed.packMode === 'outline',
                memberCount: packed.memberCount,
                packMode: packed.packMode,
                uri: uri.fsPath,
            }
        }
        if (findIndexedFile(this.db, relativePath) === null) {
            try {
                await vscode.workspace.fs.stat(uri)
            } catch {
                throw new Error('该条目不在索引中，也不在存储根内')
            }
        }
        if (item.startLine === undefined) {
            return {
                id: randomUUID(),
                kind: 'file',
                label: relativePath,
                displayPath: relativePath,
                startLine: null,
                endLine: null,
                charCount: 0,
                isTruncated: false,
                uri: uri.fsPath,
            }
        }
        const startLine = Math.max(Math.trunc(item.startLine), 1)
        const endLine = item.endLine === undefined ? startLine : Math.max(Math.trunc(item.endLine), startLine)
        const lines = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/u)
        if (startLine > lines.length) {
            throw new Error('行号超出文件长度，请检查引用位置')
        }
        const content = lines.slice(startLine - 1, endLine).join('\n')
        return {
            id: randomUUID(),
            kind: 'selection',
            label:
                startLine === endLine
                    ? `${relativePath}:${String(startLine)}`
                    : `${relativePath}:${String(startLine)}-${String(endLine)}`,
            displayPath: relativePath,
            startLine,
            endLine,
            charCount: content.length,
            isTruncated: content.length > MAX_CONTEXT_CHARS,
            uri: uri.fsPath,
        }
    }

    /** 收窄笔记本来源 id：必须是 notes/<单段> 形态 */
    private readNotebookId(sourceId: string | undefined): string {
        if (sourceId === undefined) {
            throw new Error('缺少笔记本来源')
        }
        const segments = toSafeSegments(sourceId, '笔记本')
        if (segments.length !== 2 || segments[0] !== NOTE_PATH_PREFIX.slice(0, -1)) {
            throw new Error(`笔记本来源非法：${sourceId}`)
        }
        return segments.join('/')
    }

    /** 收窄公众号来源 id：目录段只能是平台 AppID */
    private readAppId(sourceId: string | undefined): string {
        if (sourceId === undefined || !APP_ID_PATTERN.test(sourceId)) {
            throw new Error(`公众号来源非法：${String(sourceId)}`)
        }
        return sourceId
    }

    /** 收窄作品目录：必须是 press/{作品名} 两段 */
    private readProjectDir(sourceId: string | undefined): string {
        if (sourceId === undefined) {
            throw new Error('缺少作品来源')
        }
        const segments = toSafeSegments(sourceId, '作品')
        if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
            throw new Error(`作品来源非法：${sourceId}`)
        }
        return segments.join('/')
    }
}
