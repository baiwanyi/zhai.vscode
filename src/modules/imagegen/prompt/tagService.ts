/**
 * 词库服务：列举、新建、改写、删除与出图取文，词条按一级分类落在存储根下 prompt/tags 的 md。
 * 复用约定：存储根取 common/config，路径拼装与删除走 common/storagePath，预览图目录取 ../promptImageService；
 * md 的解析与序列化交给 ./tagMarkdown（格式契约见其头注释与 docs 的「词库 md 格式规范」），
 * 标识口径与前端芯片共用同一套「分类::分组::名称」。
 * 关键约束：一个分类一个 md，文件名即分类名，改分类等于换文件；同组重名一律拒绝，改名或换组按整块移动；
 * 分类清单固定把「预设」置顶，其余按中文名排序，改排序只动 listObjects 一处；
 * 出图时按标识回查原文，缺失或非法标识跳过并记日志，不阻断出图；
 * 预览图先按「分类/分组/名称」镜像查找，再按 sha1 前 10 位兜底，两处都没有则视为无图。
 */
import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, deleteResource, isPathExisting } from '@modules/common/storagePath'
import type { PromptTag, PromptTagAttribute, PromptTagListResult, PromptTagObject } from '@shared/types/imagegen'
import { MAX_PROMPT_TAG_LENGTH, MAX_PROMPT_TAGS, MAX_TAG_LABEL } from './limits'
import { parseTagId, parseTagMarkdown, serializeTagMarkdown, tagIdOf, type TagMarkdownEntry } from './tagMarkdown'
import { promptImageDirUri } from '../promptImageService'

/** 提示词模块的一级目录：与 rules、images 同级 */
const PROMPT_DIR = 'prompt'

/** 词库子目录 */
const TAG_DIR = 'tags'

/** 分类文件扩展名：只认 md，目录里的其它文件不参与列举 */
const TAG_EXTENSION = '.md'

/** 置顶分类：作品预设是出图前的首选入口，固定排在分类列表首位，其余分类仍按中文名排序 */
const PINNED_OBJECT = '预设'

/** 预览图扩展名白名单：与图库扫描口径一致 */
const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

/** 哈希兜底文件的取位：sha1 十六进制前 10 位 */
const HASH_LENGTH = 10

/** 分类名非法字符：它要作文件名，路径分隔符与 Windows 保留字符一律禁止 */
const INVALID_OBJECT_PATTERN = /[\\/:*?"<>|]/u

/** 标识分隔符：分类、分组、名称自身都不能含它，否则标识拆不出三段 */
const ID_SEPARATOR = '::'

/** 是否含控制字符：换行、制表等不可见字符写进 md 或文件名会让后续解析不可预期 */
function hasControlChar(value: string): boolean {
    return [...value].some((char) => {
        const code = char.charCodeAt(0)
        return code < 0x20 || code === 0x7f
    })
}

/** 词库目录 Uri：列举、保存与打开目录共用同一口径 */
function tagDirUri(): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [PROMPT_DIR, TAG_DIR])
}

/** 分类文件 Uri：分类名必须已通过 normalizeObject */
function tagFileUri(object: string): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [PROMPT_DIR, TAG_DIR, `${object}${TAG_EXTENSION}`])
}

/** 去掉扩展名：分类名与预览图的比对键都按无扩展名口径 */
function stripExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.')
    return dot <= 0 ? fileName : fileName.slice(0, dot)
}

/** 收窄分类名：它既是文件名又是标识首段 */
function normalizeObject(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length === 0 || text.length > MAX_TAG_LABEL) {
        throw new Error(`分类名称非法：不能为空且不超过 ${String(MAX_TAG_LABEL)} 个字符`)
    }
    if (text === '.' || text === '..' || INVALID_OBJECT_PATTERN.test(text) || hasControlChar(text)) {
        throw new Error(`分类名称非法：不能含路径分隔符、保留字符或换行`)
    }
    return text
}

/** 收窄分组名与词条名：二者只进标识与标题，但仍不允许自带分隔符与换行 */
function normalizeLabel(value: unknown, label: string): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length === 0 || text.length > MAX_TAG_LABEL) {
        throw new Error(`${label}非法：不能为空且不超过 ${String(MAX_TAG_LABEL)} 个字符`)
    }
    if (text.includes(ID_SEPARATOR) || hasControlChar(text)) {
        throw new Error(`${label}非法：不能含 ${ID_SEPARATOR} 或换行`)
    }
    return text
}

/** 收窄提示词原文：多行压成单行，与 md 解析口径一致，避免换行破坏拼装 */
function normalizePrompt(value: unknown): string {
    const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
    if (text.length === 0) {
        throw new Error('提示词原文不能为空')
    }
    if (text.length > MAX_PROMPT_TAG_LENGTH) {
        throw new Error(`提示词原文过长：上限 ${String(MAX_PROMPT_TAG_LENGTH)} 字`)
    }
    return text
}

/** 入参收窄：新建与改写共用同一口径 */
function normalizeEntry(payload: unknown): TagMarkdownEntry {
    const record = payload as { object?: unknown; attribute?: unknown; name?: unknown; prompt?: unknown } | null
    return {
        object: normalizeObject(record?.object),
        attribute: normalizeLabel(record?.attribute, '分组名称'),
        name: normalizeLabel(record?.name, '词条名称'),
        prompt: normalizePrompt(record?.prompt),
    }
}

/** 预览图索引：目录镜像与哈希兜底各存一份，列举时不逐条 stat */
interface ImageIndex {
    /** 键为去掉扩展名的「分类/分组/名称」，值为含扩展名的相对路径 */
    byPath: Map<string, string>
    /** 键为去掉扩展名的文件名，值为文件名本身，供哈希命名命中 */
    byHash: Map<string, string>
}

/** 登记一张图片：目录镜像键与扁平哈希键同时写入，先到先得 */
function registerImage(index: ImageIndex, relativePath: string, fileName: string): void {
    const pathKey = stripExtension(relativePath)
    if (!index.byPath.has(pathKey)) {
        index.byPath.set(pathKey, relativePath)
    }
    const hashKey = stripExtension(fileName)
    if (!index.byHash.has(hashKey)) {
        index.byHash.set(hashKey, fileName)
    }
}

/** 枚举预览图目录：最多下探两层（分类/分组），扁平放置的哈希图同样登记 */
async function collectImageIndex(): Promise<ImageIndex> {
    const index: ImageIndex = { byPath: new Map(), byHash: new Map() }
    const root = promptImageDirUri()
    let top: [string, vscode.FileType][]
    try {
        top = await vscode.workspace.fs.readDirectory(root)
    } catch {
        // 目录尚未创建：没有图是正常情况
        return index
    }
    for (const [name, type] of top) {
        if (type === vscode.FileType.File) {
            registerImage(index, name, name)
            continue
        }
        const objectDir = vscode.Uri.joinPath(root, name)
        let second: [string, vscode.FileType][]
        try {
            second = await vscode.workspace.fs.readDirectory(objectDir)
        } catch {
            continue
        }
        for (const [child, childType] of second) {
            if (childType === vscode.FileType.File) {
                registerImage(index, `${name}/${child}`, child)
                continue
            }
            let third: [string, vscode.FileType][]
            try {
                third = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(objectDir, child))
            } catch {
                continue
            }
            for (const [file, fileType] of third) {
                if (fileType === vscode.FileType.File) {
                    registerImage(index, `${name}/${child}/${file}`, file)
                }
            }
        }
    }
    return index
}

/** 哈希兜底键：sha1(分类-分组-名称) 前 10 位，与「目录镜像 + 哈希兜底」的约定一致 */
function previewHashKey(entry: TagMarkdownEntry): string {
    return createHash('sha1')
        .update(`${entry.object}-${entry.attribute}-${entry.name}`, 'utf8')
        .digest('hex')
        .slice(0, HASH_LENGTH)
}

/** 从索引里取预览图：先目录镜像，再哈希兜底 */
function previewOf(index: ImageIndex, entry: TagMarkdownEntry): string | null {
    const direct = index.byPath.get(`${entry.object}/${entry.attribute}/${entry.name}`)
    if (direct !== undefined) {
        return direct
    }
    return index.byHash.get(previewHashKey(entry)) ?? null
}

/** 把 md 条目转成对外的词条结构 */
function toTag(entry: TagMarkdownEntry, preview: string | null): PromptTag {
    return {
        id: tagIdOf(entry.object, entry.attribute, entry.name),
        object: entry.object,
        attribute: entry.attribute,
        name: entry.name,
        prompt: entry.prompt,
        preview,
    }
}

export class PromptTagService {
    /** 列举词库：目录缺失视为空库；分类按中文名排序，分组与词条保持 md 内顺序 */
    public async list(): Promise<PromptTagListResult> {
        const imageIndex = await collectImageIndex()
        const objects: PromptTagObject[] = []
        const tags: PromptTag[] = []
        const seen = new Set<string>()
        for (const object of await this.listObjects()) {
            const entries = await this.readEntries(object)
            const counts = new Map<string, number>()
            for (const entry of entries) {
                const id = tagIdOf(entry.object, entry.attribute, entry.name)
                // 同组重名会让标识重复：保留第一条并记日志，避免前端出现重复 key 与无法区分的芯片
                if (seen.has(id)) {
                    logger.warn(`词条标识重复，已忽略后者：${id}`)
                    continue
                }
                seen.add(id)
                counts.set(entry.attribute, (counts.get(entry.attribute) ?? 0) + 1)
                tags.push(toTag(entry, previewOf(imageIndex, entry)))
            }
            const attributes: PromptTagAttribute[] = [...counts].map(([name, count]) => ({ name, count }))
            objects.push({ name: object, attributes })
        }
        return {
            objects,
            tags,
            dirPath: tagDirUri().fsPath,
            imageDirPath: promptImageDirUri().fsPath,
        }
    }

    /** 新建词条：分类文件不存在则创建，同组同名直接拒绝，不静默覆盖 */
    public async save(payload: unknown): Promise<PromptTag> {
        const entry = normalizeEntry(payload)
        const entries = await this.readEntries(entry.object)
        const id = tagIdOf(entry.object, entry.attribute, entry.name)
        if (entries.some((item) => tagIdOf(item.object, item.attribute, item.name) === id)) {
            throw new Error(`同名词条已存在：${entry.name}`)
        }
        await this.writeEntries(entry.object, [...entries, entry])
        logger.info(`词条已保存：${entry.object} / ${entry.attribute} / ${entry.name}`)
        return toTag(entry, await this.resolvePreviewOf(entry))
    }

    /**
     * 改写词条：按原标识定位并整块替换，改名或换组即移动到目标分类文件。
     * 关键约束：目标标识已存在且不是自己时拒绝——否则会把两条词条合成一条。
     */
    public async update(payload: unknown): Promise<PromptTag> {
        const record = payload as { previousId?: unknown } | null
        const previousId = typeof record?.previousId === 'string' ? record.previousId : ''
        const previous = parseTagId(previousId)
        if (previous === null) {
            throw new Error(`词条标识非法：${previousId}`)
        }
        const entry = normalizeEntry(payload)
        const existing = await this.readAllEntries()
        if (!existing.has(previousId)) {
            throw new Error(`词条不存在：${previousId}`)
        }
        const nextId = tagIdOf(entry.object, entry.attribute, entry.name)
        if (nextId !== previousId && existing.has(nextId)) {
            throw new Error(`同名词条已存在：${entry.name}`)
        }
        const sourceEntries = (await this.readEntries(previous.object)).filter(
            (item) => tagIdOf(item.object, item.attribute, item.name) !== previousId,
        )
        if (previous.object === entry.object) {
            await this.writeEntries(entry.object, [...sourceEntries, entry])
        } else {
            // 先写目标文件，再清源文件：中途失败最多留下一条重复，可由用户删掉，不会丢数据
            await this.writeEntries(entry.object, [...(await this.readEntries(entry.object)), entry])
            await this.writeEntries(previous.object, sourceEntries)
        }
        logger.info(`词条已改写：${previousId} → ${nextId}`)
        return toTag(entry, await this.resolvePreviewOf(entry))
    }

    /** 删除词条：分类文件删空时一并移除，避免留下空标题 */
    public async remove(payload: unknown): Promise<PromptTagListResult> {
        const record = payload as { id?: unknown } | null
        const id = typeof record?.id === 'string' ? record.id : ''
        const parsed = parseTagId(id)
        if (parsed === null) {
            throw new Error(`词条标识非法：${id}`)
        }
        const entries = await this.readEntries(parsed.object)
        const remaining = entries.filter((item) => tagIdOf(item.object, item.attribute, item.name) !== id)
        if (remaining.length === entries.length) {
            throw new Error(`词条不存在：${id}`)
        }
        await this.writeEntries(parsed.object, remaining)
        logger.info(`词条已删除：${id}`)
        return this.list()
    }

    /** 打开词库目录：不存在时先建出来，再交给系统文件管理器定位，并回传最新列表 */
    public async openDir(): Promise<PromptTagListResult> {
        const dirUri = tagDirUri()
        await vscode.workspace.fs.createDirectory(dirUri)
        await vscode.commands.executeCommand('revealFileInOS', dirUri)
        return this.list()
    }

    /**
     * 出图取文：按标识回查原文，非法或缺失的标识跳过并记日志。
     * 关键约束：条数与单词条长度在此收口，避免前端带着已删除词条的芯片发请求时阻断出图。
     */
    public async readForPrompt(ids: readonly string[]): Promise<string[]> {
        if (ids.length === 0) {
            return []
        }
        const all = await this.readAllEntries()
        const prompts: string[] = []
        for (const id of ids.slice(0, MAX_PROMPT_TAGS)) {
            const entry = all.get(id)
            if (entry === undefined) {
                logger.warn(`词条不存在，已跳过：${id}`)
                continue
            }
            prompts.push(entry.prompt.slice(0, MAX_PROMPT_TAG_LENGTH))
        }
        return prompts
    }

    /** 分类清单：tags 目录下的 md 文件名主干，「预设」置顶，其余按中文排序 */
    private async listObjects(): Promise<string[]> {
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(tagDirUri())
        } catch {
            return []
        }
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith(TAG_EXTENSION))
            .map(([name]) => stripExtension(name))
            .sort((left, right) => {
                if (left === right) {
                    return 0
                }
                if (left === PINNED_OBJECT) {
                    return -1
                }
                if (right === PINNED_OBJECT) {
                    return 1
                }
                return left.localeCompare(right, 'zh')
            })
    }

    /** 读取一个分类文件：不存在或读取失败按空处理，分类以文件名为准 */
    private async readEntries(object: string): Promise<TagMarkdownEntry[]> {
        try {
            const bytes = await vscode.workspace.fs.readFile(tagFileUri(object))
            return parseTagMarkdown(Buffer.from(bytes).toString('utf8')).map((entry) => ({ ...entry, object }))
        } catch {
            return []
        }
    }

    /** 读取全部词条并按标识建索引：出图取文与更新查重共用，避免重复解析 */
    private async readAllEntries(): Promise<Map<string, TagMarkdownEntry>> {
        const map = new Map<string, TagMarkdownEntry>()
        for (const object of await this.listObjects()) {
            for (const entry of await this.readEntries(object)) {
                map.set(tagIdOf(entry.object, entry.attribute, entry.name), entry)
            }
        }
        return map
    }

    /** 写回一个分类文件：条目为空时删除文件，不让空标题留在目录里 */
    private async writeEntries(object: string, entries: readonly TagMarkdownEntry[]): Promise<void> {
        const fileUri = tagFileUri(object)
        if (entries.length === 0) {
            if (await isPathExisting(fileUri)) {
                await deleteResource(fileUri, false)
            }
            return
        }
        await vscode.workspace.fs.createDirectory(tagDirUri())
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(serializeTagMarkdown(object, entries)))
    }

    /** 单条预览图：按精确路径与哈希各试一遍扩展名，保存后立即回显用 */
    private async resolvePreviewOf(entry: TagMarkdownEntry): Promise<string | null> {
        const dirUri = promptImageDirUri()
        for (const extension of PREVIEW_EXTENSIONS) {
            const mirrored = vscode.Uri.joinPath(dirUri, entry.object, entry.attribute, `${entry.name}.${extension}`)
            if (await isPathExisting(mirrored)) {
                return `${entry.object}/${entry.attribute}/${entry.name}.${extension}`
            }
        }
        const hashKey = previewHashKey(entry)
        for (const extension of PREVIEW_EXTENSIONS) {
            const hashed = vscode.Uri.joinPath(dirUri, `${hashKey}.${extension}`)
            if (await isPathExisting(hashed)) {
                return `${hashKey}.${extension}`
            }
        }
        return null
    }
}
