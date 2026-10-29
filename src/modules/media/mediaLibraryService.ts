/**
 * 媒体库服务：列举、详情、删除、设封面、插入正文与复制，是媒体页与角色/设定页共用的唯一数据入口。
 * 复用约定：索引读写走 mediaRepository，磁盘扫描走 mediaScan，引用重建走 mediaReferenceService；
 * 作品封面指针沿用 PressCoverStore（press.db meta 表），路径与片段校验复用 common/storagePath；
 * 插入正文写「相对原图路径」而不是复制副本，跨盘等无法相对化的场景才复制到文档同级 assets。
 * 关键约束：磁盘是唯一事实来源——列举前先做一次节流对账（目录遍历），补录手工放入的图片与标记丢失；
 * 前端只传媒体 id，路径一律由表查得后再校验 images/{YYYYMM}/ 形态，不接受任意路径；
 * 删除前不回退引用，而是把引用清单一并回传给前端二次确认；封面被删时回退到该作品出处的最新一张。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { readProjectSegments } from '@modules/common/projectPath'
import { buildStorageUri, deleteResource, isPathExisting } from '@modules/common/storagePath'
import type { PressCoverStore } from '@modules/media/pressCoverStore'
import { isMediaId, isMediaMonth, readMediaIdFromPath } from '@shared/types/media'
import type {
    MediaBatchDeleteResult,
    MediaCopyResult,
    MediaDeleteResult,
    MediaDetailResult,
    MediaInsertResult,
    MediaItem,
    MediaListResult,
    MediaRefScope,
    MediaRefType,
    MediaRescanResult,
    MediaSetCoverResult,
    MediaUsageItem,
} from '@shared/types/media'
import { writeImageToClipboard } from './clipboardImage'
import { MAX_BATCH_DELETE } from './constants'
import { clearCoverUsage, rescanReferences, setCoverUsage } from './mediaReferenceService'
import {
    clearUsagesByMedia,
    countMedia,
    deleteMedia,
    findLatestOfProject,
    findMedia,
    insertUsage,
    listByCharacter,
    listByLore,
    listMonths,
    listMedia,
    listUsages,
} from './mediaRepository'
import { reconcileMedia, scanMediaFiles } from './mediaScan'
import type { MediaDatabase } from './db/connection'
import type { StoredMedia } from './mediaRepository'

/** 列举前的对账节流窗口：短时间内反复打开面板不重复遍历磁盘 */
const RECONCILE_INTERVAL_MS = 5_000

/** 依赖注入：数据库按当前存储根懒打开，封面指针复用写作管理库 */
interface MediaServiceDeps {
    openDatabase: () => MediaDatabase
    coverStore: PressCoverStore
}

/**
 * 把仓库记录转成协议条目：url 由宿主签发，仅本次会话有效。
 * @param withParams 是否带上出图参数——列表不带（提示词体积大），详情带
 */
function toMediaItem(row: StoredMedia, toWebviewUri: (uri: vscode.Uri) => string, withParams: boolean): MediaItem {
    const root = resolveStorageRoot()
    return {
        id: row.id,
        path: row.path,
        url: toWebviewUri(buildStorageUri(root, row.path.split('/'))),
        ext: row.ext,
        byteSize: row.byteSize,
        month: row.month,
        createdAt: row.createdAt,
        scope: row.scope,
        origin: row.origin,
        kind: row.kind,
        pressPath: row.pressPath,
        pressName: row.pressName,
        characterId: row.characterId,
        characterName: row.characterName,
        loreKind: row.loreKind,
        loreId: row.loreId,
        loreName: row.loreName,
        usageCount: row.usageCount,
        missing: row.missing,
        prompt: withParams ? row.prompt : null,
        ratio: withParams ? row.ratio : null,
        style: withParams ? row.style : null,
        enhancedFrom: withParams ? row.enhancedFrom : null,
    }
}

/** 入参收窄：非对象一律拒绝 */
function readPayload(payload: unknown, method: string): Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    return payload as Record<string, unknown>
}

/** 读取媒体标识：只接受新命名，旧命名请先迁移 */
function readMediaId(payload: unknown, method: string): string {
    const value = readPayload(payload, method).id
    if (!isMediaId(value)) {
        throw new Error(`${method} 缺少合法的图片标识`)
    }
    return value
}

/** 列举入参：month 缺省或非法值时按全部处理，不因脏参数阻断页面 */
function readListMonth(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const value = (payload as { month?: unknown }).month
    return isMediaMonth(value) ? value : null
}

/** 批量删除入参：去重、限长，任一项不是合法 id 即整单拒绝 */
function readMediaIds(payload: unknown): string[] {
    const raw = readPayload(payload, 'media/deleteBatch').ids
    const ids = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
    if (ids.length === 0) {
        throw new Error('缺少待删除的图片标识')
    }
    if (ids.length > MAX_BATCH_DELETE) {
        throw new Error(`一次最多删除 ${String(MAX_BATCH_DELETE)} 张图片`)
    }
    const unique = [...new Set(ids)]
    for (const id of unique) {
        // 收窄失败的 id 已被排除为 never，消息里不再拼接它本身
        if (!isMediaId(id)) {
            throw new Error('图片标识非法')
        }
    }
    return unique
}

/** 把绝对路径归一为存储根相对路径：不在存储根内返回 null（外部文档） */
function toStorageRelative(fsPath: string): string | null {
    const rootPath = resolveStorageRoot().fsPath
    const relative = path.relative(path.resolve(rootPath), path.resolve(fsPath))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null
    }
    return relative.split(path.sep).join('/')
}

/** 按文档位置判定引用类型：作品章节、笔记或外部文档 */
function toRefType(documentRelative: string | null): { refType: MediaRefType; refScope: MediaRefScope } {
    if (documentRelative === null) {
        return { refType: 'external', refScope: 'absolute' }
    }
    if (documentRelative.startsWith('notes/')) {
        return { refType: 'note', refScope: 'storage' }
    }
    if (documentRelative.startsWith('press/')) {
        return { refType: 'chapter', refScope: 'storage' }
    }
    return { refType: 'external', refScope: 'storage' }
}

/** markdown 路径是否需要尖括号包裹：含空格或圆括号时必须包裹 */
function needsAngleBracket(value: string): boolean {
    return /[\s()]/u.test(value)
}

/** alt 文本取值顺序：角色名 → 条目名 → 作品名 → 日期 */
function toAltText(row: StoredMedia): string {
    if (row.characterName !== null && row.characterName.length > 0) {
        return row.characterName
    }
    if (row.loreName !== null && row.loreName.length > 0) {
        return row.loreName
    }
    if (row.pressName !== null && row.pressName.length > 0) {
        return row.pressName
    }
    return `媒体 ${row.createdAt.slice(0, 10)}`
}

/** 取插入目标：优先活动编辑器，其次最近可见的 Markdown 编辑器 */
function resolveInsertTarget(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor
    if (active !== undefined) {
        return active
    }
    return [...vscode.window.visibleTextEditors]
        .reverse()
        .find((item) => item.document.languageId === 'markdown' && item.document.uri.scheme === 'file')
}

export class MediaLibraryService {
    /** 上次对账时刻：节流窗口内不重复遍历磁盘 */
    private lastReconcileAt = 0

    public constructor(private readonly deps: MediaServiceDeps) {}

    /** 列举：month 为空返回全部，按年月与时间倒序；months 供下拉与分组头使用 */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<MediaListResult> {
        await this.reconcileIfStale()
        const { db } = this.deps.openDatabase()
        const month = readListMonth(payload)
        return {
            items: listMedia(db, month).map((row) => toMediaItem(row, toWebviewUri, false)),
            months: listMonths(db),
            total: countMedia(db),
        }
    }

    /** 详情：条目本身 + 全部引用，引用按类型分组由前端完成 */
    public detail(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): MediaDetailResult {
        const id = readMediaId(payload, 'media/detail')
        const { db } = this.deps.openDatabase()
        const row = findMedia(db, id)
        if (row === null) {
            throw new Error('图片不存在或已被删除')
        }
        return { item: toMediaItem(row, toWebviewUri, true), usages: listUsages(db, id) }
    }

    /** 删除单张：进回收站，成功后清引用与表行，并按引用回退作品封面 */
    public async remove(payload: unknown): Promise<MediaDeleteResult> {
        const id = readMediaId(payload, 'media/delete')
        const { db } = this.deps.openDatabase()
        const row = findMedia(db, id)
        if (row === null) {
            return {
                removed: false,
                usages: [],
                coverSelectedId: null,
                characterCoverFallbacks: {},
                loreCoverFallbacks: {},
            }
        }
        const usages = listUsages(db, id)
        // 回退候选必须在删行之前算好：删完之后就查不到该角色/条目还剩哪些图
        const characterCoverFallbacks = this.collectCoverFallbacks(db, row, 'character')
        const loreCoverFallbacks = this.collectCoverFallbacks(db, row, 'lore')
        const target = buildStorageUri(resolveStorageRoot(), row.path.split('/'))
        try {
            await deleteResource(target, false)
        } catch (error) {
            logger.error(`媒体删除失败：${row.path}`, error)
            return {
                removed: false,
                usages,
                coverSelectedId: null,
                characterCoverFallbacks: {},
                loreCoverFallbacks: {},
            }
        }
        db.transaction(() => {
            clearUsagesByMedia(db, id)
            deleteMedia(db, id)
        })()
        const coverSelectedId = this.fallbackCovers(db, row, usages)
        logger.info(`媒体已删除：${row.path}`)
        return { removed: true, usages, coverSelectedId, characterCoverFallbacks, loreCoverFallbacks }
    }

    /** 批量删除：整单校验后逐条执行，单条失败只记回执，最后回传最新年月聚合 */
    public async batchRemove(payload: unknown): Promise<MediaBatchDeleteResult> {
        const ids = readMediaIds(payload)
        const { db } = this.deps.openDatabase()
        const removals: { id: string; removed: boolean }[] = []
        for (const id of ids) {
            const row = findMedia(db, id)
            if (row === null) {
                removals.push({ id, removed: false })
                continue
            }
            const usages = listUsages(db, id)
            try {
                await deleteResource(buildStorageUri(resolveStorageRoot(), row.path.split('/')), false)
            } catch (error) {
                logger.error(`批量删除中的单张失败：${row.path}`, error)
                removals.push({ id, removed: false })
                continue
            }
            db.transaction(() => {
                clearUsagesByMedia(db, id)
                deleteMedia(db, id)
            })()
            this.fallbackCovers(db, row, usages)
            removals.push({ id, removed: true })
        }
        return { removals, months: listMonths(db), total: countMedia(db) }
    }

    /** 设为作品封面：写指针 + 登记引用，供设定页只读展示 */
    public async setCover(payload: unknown): Promise<MediaSetCoverResult> {
        const id = readMediaId(payload, 'media/setCover')
        const rawDirPath = readPayload(payload, 'media/setCover').pressPath
        if (typeof rawDirPath !== 'string' || rawDirPath.length === 0) {
            throw new Error('media/setCover 缺少作品目录')
        }
        const dirPath = readProjectSegments(rawDirPath).join('/')
        const { db } = this.deps.openDatabase()
        const row = findMedia(db, id)
        if (row === null) {
            throw new Error('图片不存在或已被删除')
        }
        const target = buildStorageUri(resolveStorageRoot(), row.path.split('/'))
        if (!(await isPathExisting(target))) {
            throw new Error('图片文件已不存在，请刷新列表')
        }
        this.deps.coverStore.write(dirPath, row.path)
        setCoverUsage(
            db,
            { refType: 'press_cover', refPath: dirPath, refId: null, refTitle: dirPath.split('/')[1] ?? dirPath },
            id,
        )
        logger.info(`作品封面已更新：${dirPath} ← ${row.path}`)
        return { coverSelectedId: id }
    }

    /**
     * 插入到当前编辑器光标处：写指向原图的相对路径，不复制副本。
     * 跨盘等无法相对化的场景降级为复制到文档同级 assets，并如实回传所用形态。
     */
    public async insert(payload: unknown): Promise<MediaInsertResult> {
        const id = readMediaId(payload, 'media/insert')
        const { db } = this.deps.openDatabase()
        const row = findMedia(db, id)
        if (row === null) {
            throw new Error('图片不存在或已被删除')
        }
        const root = resolveStorageRoot()
        const source = buildStorageUri(root, row.path.split('/'))
        if (!(await isPathExisting(source))) {
            throw new Error('图片文件已不存在，请刷新列表')
        }
        const editor = resolveInsertTarget()
        if (editor === undefined) {
            return { inserted: false, reason: 'no-editor' }
        }
        const document = editor.document
        if (document.uri.scheme !== 'file') {
            return { inserted: false, reason: 'unsaved' }
        }
        if (document.languageId !== 'markdown') {
            return { inserted: false, reason: 'not-markdown' }
        }
        const documentPath = document.uri.fsPath
        const documentRelative = toStorageRelative(documentPath)
        const relative = path.relative(path.dirname(documentPath), source.fsPath)
        let refPath: string
        if (path.isAbsolute(relative)) {
            // 跨盘：相对路径无法表达，降级为文档内副本，保证预览仍可显示
            refPath = await this.copyToAssets(document, row)
        } else {
            refPath = relative.split(path.sep).join('/')
        }
        const alt = toAltText(row).replaceAll('[', '').replaceAll(']', '')
        const target = needsAngleBracket(refPath) ? `<${refPath}>` : refPath
        const snippet = `![${alt}](${target})`
        const insertAt = editor.selection.active
        const didInsert = await editor.edit((builder) => {
            builder.insert(insertAt, snippet)
        })
        if (!didInsert) {
            return { inserted: false, reason: 'failed' }
        }
        const range = new vscode.Range(insertAt, insertAt.translate(0, snippet.length))
        await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: range })
        const { refType, refScope } = toRefType(documentRelative)
        const usagePath = documentRelative ?? documentPath
        const isDuplicated = listUsages(db, id).some(
            (usage) => usage.refPath === usagePath && usage.refType === refType,
        )
        insertUsage(db, id, {
            refType,
            refPath: usagePath,
            refScope,
            refId: null,
            refTitle: document.fileName.replace(/\.md$/iu, ''),
            refAnchor: null,
        })
        return { inserted: true, refPath, duplicated: isDuplicated }
    }

    /** 复制图片到系统剪贴板：webview 无权直接写，统一由宿主执行 */
    public async copy(payload: unknown): Promise<MediaCopyResult> {
        const id = readMediaId(payload, 'media/copy')
        const { db } = this.deps.openDatabase()
        const row = findMedia(db, id)
        if (row === null) {
            throw new Error('图片不存在或已被删除')
        }
        const target = buildStorageUri(resolveStorageRoot(), row.path.split('/'))
        const outcome = await writeImageToClipboard(target.fsPath, row.ext)
        return outcome === 'copied' ? { copied: true } : { copied: false, reason: outcome }
    }

    /** 全量对账：目录补录 + 文档引用重建，供打开媒体页与手动刷新调用 */
    public async rescan(): Promise<MediaRescanResult> {
        const mediaDb = this.deps.openDatabase()
        const files = await scanMediaFiles(resolveStorageRoot())
        const reconcile = reconcileMedia(mediaDb, files)
        const references = await rescanReferences(mediaDb.db, (dirPath) => this.deps.coverStore.read(dirPath))
        this.lastReconcileAt = Date.now()
        return {
            indexed: reconcile.indexed,
            missing: reconcile.missing,
            corrected: reconcile.corrected,
            stale: references.stale,
        }
    }

    /** 节流对账：打开页面时补齐手工放入的图片，不解析文档（引用由 rescan 负责） */
    private async reconcileIfStale(): Promise<void> {
        const now = Date.now()
        if (now - this.lastReconcileAt < RECONCILE_INTERVAL_MS) {
            return
        }
        this.lastReconcileAt = now
        try {
            const mediaDb = this.deps.openDatabase()
            reconcileMedia(mediaDb, await scanMediaFiles(resolveStorageRoot()))
        } catch (error) {
            // 对账失败不影响列表读取：索引里已有的图片照常展示
            logger.error('媒体目录对账失败', error)
        }
    }

    /** 复制到文档同级 assets：跨盘插入的降级路径，返回写入正文的相对路径 */
    private async copyToAssets(document: vscode.TextDocument, row: StoredMedia): Promise<string> {
        const fileName = row.path.split('/').pop() ?? `${row.id}.${row.ext}`
        const assetDirectory = vscode.Uri.joinPath(document.uri, '..', 'assets')
        await vscode.workspace.fs.createDirectory(assetDirectory)
        const bytes = await vscode.workspace.fs.readFile(buildStorageUri(resolveStorageRoot(), row.path.split('/')))
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(assetDirectory, fileName), bytes)
        return `assets/${fileName}`
    }

    /**
     * 收集角色 / 条目封面的回退候选：该出处下除被删图之外的最新一张。
     * 必须在删行之前调用——删完就查不到该角色或条目还有哪些图；
     * 只在被删图本身带有对应归属时返回，避免为无关图片做无谓查询。
     */
    private collectCoverFallbacks(
        db: MediaDatabase['db'],
        row: StoredMedia,
        target: 'character' | 'lore',
    ): Record<string, string | null> {
        if (row.pressPath === null) {
            return {}
        }
        if (target === 'character') {
            if (row.characterId === null) {
                return {}
            }
            const rest = listByCharacter(db, row.pressPath, row.characterId).filter((item) => item.id !== row.id)
            return { [row.characterId]: rest[0]?.id ?? null }
        }
        if (row.loreId === null) {
            return {}
        }
        const rest = listByLore(db, row.pressPath, row.loreKind, row.loreId).filter((item) => item.id !== row.id)
        return { [row.loreId]: rest[0]?.id ?? null }
    }

    /**
     * 封面回退：被删图若是某个作品的封面，指针改到该作品出处的最新一张。
     * 只处理引用里出现的 press_cover，避免遍历全部作品。
     */
    private fallbackCovers(
        db: MediaDatabase['db'],
        row: StoredMedia,
        usages: readonly MediaUsageItem[],
    ): string | null {
        let selected: string | null = null
        for (const usage of usages) {
            if (usage.refType !== 'press_cover') {
                continue
            }
            const current = this.deps.coverStore.read(usage.refPath)
            if (current !== row.path) {
                selected = current === null ? null : readMediaIdFromPath(current)
                continue
            }
            const next = findLatestOfProject(db, usage.refPath, row.id)
            this.deps.coverStore.write(usage.refPath, next?.path ?? null)
            if (next === null) {
                clearCoverUsage(db, 'press_cover', usage.refPath)
                selected = null
                continue
            }
            setCoverUsage(
                db,
                {
                    refType: 'press_cover',
                    refPath: usage.refPath,
                    refId: null,
                    refTitle: usage.refPath.split('/')[1] ?? usage.refPath,
                },
                next.id,
            )
            selected = next.id
        }
        return selected
    }
}
