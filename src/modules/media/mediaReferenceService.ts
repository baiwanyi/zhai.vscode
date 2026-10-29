/**
 * 媒体引用服务：登记与重建「图片被谁使用」的关系，覆盖作品封面、角色/条目封面与正文引用。
 * 复用约定：路径一律相对存储根，文档遍历只走作品目录与 notes 目录，扩展名固定 md；
 * 正文引用同时识别四种写法——@zhai/ 存储根引用、images/ 相对路径、文档同级 assets/ 副本名、存储根内绝对路径；
 * 写入复用 mediaRepository 的 insertUsage / replaceUsagesOfDocument，不另写一份 SQL。
 * 关键约束：引用按文档整篇替换（先删后插），同一文档内多次引用同一张图只留一行，避免引用数虚高；
 * 找不到对应媒体的引用记为 stale 且不落库，防止把已删除的图重新挂回来；
 * 角色卡文档没有 id 行，角色封面的 ref_id 用角色名承担区分键，条目封面用条目自带的 id 行。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { buildStorageUri } from '@modules/common/storagePath'
import type { MediaRefType } from '@shared/types/media'
import { isZhaiPath, readZhaiRelativePath } from '@shared/utils/zhaiPath'
import { PRESS_SCANNED_FILES } from './constants'
import { insertUsage, listMediaPaths, replaceUsagesOfDocument } from './mediaRepository'
import type { UsageRecord } from './mediaRepository'
import type Database from 'better-sqlite3'

/** markdown 图片语法：支持尖括号包裹的含空格路径与可选 title */
const IMAGE_REF_PATTERN = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu
/** 封面行：`- 封面：<mediaId>`，与 serialize 写出的格式一致 */
const COVER_LINE_PATTERN = /^\s*[-*]\s*封面[：:]\s*(\S+)\s*$/u
/** 标题行：一级 / 二级 */
const HEADING_PATTERN = /^(#{1,2})\s+(.+?)\s*$/u
/** 条目 id 行：`- id：xxx` */
const LORE_ID_LINE_PATTERN = /^\s*[-*]\s*id[：:]\s*(\S+)\s*$/u
/** markdown 扩展名 */
const MARKDOWN_PATTERN = /\.md$/iu

/** 一次扫描的统计：stale 表示解析到但找不到对应媒体的引用数 */
interface ReferenceScanOutcome {
    documents: number
    usages: number
    stale: number
}

/** 封面登记目标：作品级或文档级 */
interface CoverTarget {
    refType: 'press_cover' | 'character_cover' | 'lore_cover'
    /** 作品封面传 press/{作品名}；角色与条目封面传对应文档路径 */
    refPath: string
    refId: string | null
    refTitle: string | null
}

/** 媒体索引：同时按 id 与相对路径建表，正文两种写法各走一路 */
interface MediaLookup {
    byId: Map<string, string>
    byPath: Map<string, string>
}

/** 由仓储行构建查找表 */
function buildLookup(rows: readonly { id: string; path: string }[]): MediaLookup {
    const byId = new Map<string, string>()
    const byPath = new Map<string, string>()
    for (const row of rows) {
        byId.set(row.id, row.id)
        byPath.set(row.path, row.id)
    }
    return { byId, byPath }
}

/** 去掉尖括号与 URL 编码：Markdown 里含空格路径常写成 `<...>` 或 `%20` */
function normalizeReference(raw: string): string {
    const trimmed = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
    try {
        return decodeURI(trimmed)
    } catch {
        return trimmed
    }
}

/** 把绝对路径归一为存储根相对路径：不在存储根内返回 null */
function toStorageRelative(absolutePath: string): string | null {
    const rootPath = resolveStorageRoot().fsPath
    const relative = path.relative(path.resolve(rootPath), path.resolve(absolutePath))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null
    }
    return relative.split(path.sep).join('/')
}

/**
 * 把正文里的一个图片引用解析为媒体 id。
 * @param documentDir 文档所在目录的存储根相对路径，如 press/长夜行/Chapters
 */
function resolveReference(documentDir: string, raw: string, lookup: MediaLookup): string | null {
    const normalized = normalizeReference(raw)
    // 存储根引用（@zhai/…）：路径本身已是存储根相对形态，不需要再按文档目录拼接
    if (isZhaiPath(normalized)) {
        const relative = readZhaiRelativePath(normalized)
        if (relative === null) {
            return null
        }
        const byPath = lookup.byPath.get(relative)
        if (byPath !== undefined) {
            return byPath
        }
        return (
            lookup.byId.get(
                relative
                    .split('/')
                    .pop()
                    ?.replace(/\.[^.]+$/u, '') ?? '',
            ) ?? null
        )
    }
    if (path.isAbsolute(normalized)) {
        const relative = toStorageRelative(normalized)
        if (relative === null) {
            return null
        }
        const byPath = lookup.byPath.get(relative)
        if (byPath !== undefined) {
            return byPath
        }
        return (
            lookup.byId.get(
                relative
                    .split('/')
                    .pop()
                    ?.replace(/\.[^.]+$/u, '') ?? '',
            ) ?? null
        )
    }
    const absolute = path.posix.resolve('/', documentDir, normalized).replace(/^\/+/u, '')
    const direct = lookup.byPath.get(absolute)
    if (direct !== undefined) {
        return direct
    }
    // 兼容迁移期的 assets 副本：同一张图被复制到文档同级目录，文件名主干与媒体 id 相同
    const fileName = absolute.split('/').pop() ?? ''
    return lookup.byId.get(fileName.replace(/\.[^.]+$/u, '')) ?? null
}

/** 解析结果：引用列表 + 未命中的数量 */
interface ParsedDocument {
    references: { mediaId: string; refAnchor: string | null }[]
    stale: number
}

/**
 * 解析一篇文档里的图片引用。
 * 同一文档多次引用同一张图只记一条，ref_anchor 记首次出现的行号，引用数不随插入次数虚增。
 */
function parseImageReferences(text: string, documentPath: string, lookup: MediaLookup): ParsedDocument {
    const documentDir = path.posix.dirname(documentPath)
    const references: { mediaId: string; refAnchor: string | null }[] = []
    let stale = 0
    const seen = new Set<string>()
    for (const matched of text.matchAll(IMAGE_REF_PATTERN)) {
        const raw = matched[1]
        if (raw === undefined) {
            continue
        }
        const mediaId = resolveReference(documentDir, raw, lookup)
        if (mediaId === null) {
            stale += 1
            continue
        }
        if (seen.has(mediaId)) {
            continue
        }
        seen.add(mediaId)
        const lineIndex = matched.index === undefined ? 0 : text.slice(0, matched.index).split('\n').length
        references.push({ mediaId, refAnchor: String(lineIndex) })
    }
    return { references, stale }
}

/** 解析出的一块（角色块或条目块）：标题、可选的实体 id 与封面 */
interface CoverBlock {
    title: string
    entityId: string | null
    coverId: string | null
}

/**
 * 按标题切块抽取封面行。
 * @param level 1 = 角色卡一级标题；2 = 条目文档二级标题
 */
function parseCoverBlocks(text: string, level: 1 | 2): CoverBlock[] {
    const blocks: CoverBlock[] = []
    let current: CoverBlock | null = null
    for (const line of text.split(/\r?\n/u)) {
        const heading = HEADING_PATTERN.exec(line)
        if (heading !== null && heading[1]?.length === level) {
            current = { title: (heading[2] ?? '').trim(), entityId: null, coverId: null }
            blocks.push(current)
            continue
        }
        if (current === null) {
            continue
        }
        const cover = COVER_LINE_PATTERN.exec(line)
        if (cover !== null) {
            current.coverId = cover[1] ?? null
            continue
        }
        const idLine = LORE_ID_LINE_PATTERN.exec(line)
        if (idLine !== null) {
            current.entityId = idLine[1] ?? null
        }
    }
    return blocks.filter((block) => block.coverId !== null)
}

/** 读取文本：文件不存在或读取失败返回 null，由调用方按空文档处理 */
async function readDocument(root: vscode.Uri, relativePath: string): Promise<string | null> {
    try {
        const bytes = await vscode.workspace.fs.readFile(buildStorageUri(root, relativePath.split('/')))
        return Buffer.from(bytes).toString('utf8')
    } catch {
        return null
    }
}

/** 列举目录下的条目：目录缺失视为空 */
async function readDirectory(root: vscode.Uri, relativePath: string): Promise<[string, vscode.FileType][]> {
    try {
        return await vscode.workspace.fs.readDirectory(buildStorageUri(root, relativePath.split('/')))
    } catch {
        return []
    }
}

/** 判断存储根内某个文件是否存在 */
async function fileExists(root: vscode.Uri, relativePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(buildStorageUri(root, relativePath.split('/')))
        return true
    } catch {
        return false
    }
}

/** 递归收集 markdown 文件：章节按卷分子目录，下探两层足够 */
async function collectMarkdown(root: vscode.Uri, relativeDir: string, depth = 2): Promise<string[]> {
    const files: string[] = []
    for (const [name, type] of await readDirectory(root, relativeDir)) {
        const child = `${relativeDir}/${name}`
        if (type === vscode.FileType.Directory && depth > 0) {
            files.push(...(await collectMarkdown(root, child, depth - 1)))
            continue
        }
        if (type === vscode.FileType.File && MARKDOWN_PATTERN.test(name)) {
            files.push(child)
        }
    }
    return files
}

/** 设置封面：先清同一目标的旧封面引用，再登记新的一条 */
export function setCoverUsage(db: Database.Database, target: CoverTarget, mediaId: string): void {
    db.transaction(() => {
        db.prepare('DELETE FROM media_usage WHERE ref_type = ? AND ref_path = ?').run(target.refType, target.refPath)
        insertUsage(db, mediaId, {
            refType: target.refType,
            refPath: target.refPath,
            refScope: 'storage',
            refId: target.refId,
            refTitle: target.refTitle,
            refAnchor: null,
        })
    })()
}

/** 清除封面引用：封面被删除或回退时调用 */
export function clearCoverUsage(db: Database.Database, refType: CoverTarget['refType'], refPath: string): void {
    db.prepare('DELETE FROM media_usage WHERE ref_type = ? AND ref_path = ?').run(refType, refPath)
}

/** 读取作品封面指针的注入接口：避免媒体模块直接依赖 press.db */
type PressCoverReader = (dirPath: string) => string | null

/** 文档标题：去掉扩展名与序号前缀（01- 卷名 / 01-章节名） */
function toDocumentTitle(fileName: string): string {
    return fileName
        .replace(MARKDOWN_PATTERN, '')
        .replace(/^\d{2,3}-/u, '')
        .trim()
}

/** 单篇文档的引用装配：正文图片 + 角色/条目封面 */
function collectDocumentUsages(
    documentPath: string,
    text: string,
    lookup: MediaLookup,
): { entries: { mediaId: string; usage: UsageRecord }[]; stale: number } {
    const fileName = documentPath.split('/').pop() ?? ''
    const isCharacterDoc = fileName === '角色设定.md'
    const isLoreDoc = fileName === '势力.md' || fileName === '地点.md' || fileName === '物品.md'
    const entries: { mediaId: string; usage: UsageRecord }[] = []
    const parsed = parseImageReferences(text, documentPath, lookup)
    const title = toDocumentTitle(fileName)
    for (const reference of parsed.references) {
        entries.push({
            mediaId: reference.mediaId,
            usage: {
                refType: 'chapter',
                refPath: documentPath,
                refScope: 'storage',
                refId: null,
                refTitle: title,
                refAnchor: reference.refAnchor,
            },
        })
    }
    let stale = parsed.stale
    if (isCharacterDoc || isLoreDoc) {
        for (const block of parseCoverBlocks(text, isCharacterDoc ? 1 : 2)) {
            if (block.coverId === null) {
                continue
            }
            if (!lookup.byId.has(block.coverId)) {
                stale += 1
                continue
            }
            const refType: MediaRefType = isCharacterDoc ? 'character_cover' : 'lore_cover'
            entries.push({
                mediaId: block.coverId,
                usage: {
                    refType,
                    refPath: documentPath,
                    refScope: 'storage',
                    // 角色卡文档没有 id 行：用角色名作为区分键，保证同一文档多个角色的封面各占一行
                    refId: isCharacterDoc ? block.title : (block.entityId ?? block.title),
                    refTitle: block.title,
                    refAnchor: null,
                },
            })
        }
    }
    return { entries, stale }
}

/**
 * 重建引用：扫描作品文档与笔记，按文档整篇替换引用记录。
 * @param readPressCover 作品封面指针读取：值为媒体相对路径，用于补登 press_cover
 * @param onlyDirPath 只扫某个作品，缺省扫全部
 */
export async function rescanReferences(
    db: Database.Database,
    readPressCover: PressCoverReader,
    onlyDirPath?: string,
): Promise<ReferenceScanOutcome> {
    const root = resolveStorageRoot()
    const lookup = buildLookup(listMediaPaths(db))
    const outcome: ReferenceScanOutcome = { documents: 0, usages: 0, stale: 0 }
    const projectDirs =
        onlyDirPath === undefined
            ? (await readDirectory(root, 'press'))
                  .filter(([, type]) => type === vscode.FileType.Directory)
                  .map(([name]) => `press/${name}`)
            : [onlyDirPath]

    for (const dirPath of projectDirs) {
        const projectName = dirPath.split('/')[1] ?? dirPath
        // 作品封面来自 press.db 指针，不在任何文档里：单独登记，不与文档整篇替换混在一起
        const coverPath = readPressCover(dirPath)
        if (coverPath !== null) {
            const mediaId = lookup.byPath.get(coverPath)
            if (mediaId !== undefined) {
                setCoverUsage(
                    db,
                    { refType: 'press_cover', refPath: dirPath, refId: null, refTitle: projectName },
                    mediaId,
                )
                outcome.usages += 1
            }
        }
        const documents = await collectMarkdown(root, `${dirPath}/Chapters`)
        for (const name of PRESS_SCANNED_FILES) {
            const candidate = `${dirPath}/${name}`
            if (await fileExists(root, candidate)) {
                documents.push(candidate)
            }
        }
        for (const documentPath of documents) {
            const text = await readDocument(root, documentPath)
            if (text === null) {
                continue
            }
            const { entries, stale } = collectDocumentUsages(documentPath, text, lookup)
            outcome.stale += stale
            replaceUsagesOfDocument(db, documentPath, entries)
            outcome.documents += 1
            outcome.usages += entries.length
        }
    }

    // 笔记：notes/{YYYYMM}/*.md
    for (const [monthDir, monthType] of await readDirectory(root, 'notes')) {
        if (monthType !== vscode.FileType.Directory) {
            continue
        }
        for (const [name, fileType] of await readDirectory(root, `notes/${monthDir}`)) {
            if (fileType !== vscode.FileType.File || !MARKDOWN_PATTERN.test(name)) {
                continue
            }
            const documentPath = `notes/${monthDir}/${name}`
            const text = await readDocument(root, documentPath)
            if (text === null) {
                continue
            }
            const { references, stale } = parseImageReferences(text, documentPath, lookup)
            outcome.stale += stale
            replaceUsagesOfDocument(
                db,
                documentPath,
                references.map((reference) => ({
                    mediaId: reference.mediaId,
                    usage: {
                        refType: 'note',
                        refPath: documentPath,
                        refScope: 'storage' as const,
                        refId: null,
                        refTitle: toDocumentTitle(name),
                        refAnchor: reference.refAnchor,
                    },
                })),
            )
            outcome.documents += 1
            outcome.usages += references.length
        }
    }
    return outcome
}
