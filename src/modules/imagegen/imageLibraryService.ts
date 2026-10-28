/**
 * 图片库服务：按作品把统一目录 Images 中的图片聚合为一份可管理列表，
 * 提供列举、单张删除、批量删除、设为作品封面与侧车读取能力，
 * 是图片总览页、角色卡页与设定条目页共用的唯一数据入口。
 * 复用约定：目录名取自 ./constants，路径归属校验复用 ./db/coverRepository 的 isProjectImagePath，
 * 封面指针沿用 PressCoverStore（press.db 的 meta 表），作品目录归一复用 ../common/projectPath。
 * 关键约束：磁盘是唯一事实来源，任何写操作后都按目录重扫，不维护内存缓存；
 * 侧车 {id}.json 跟随图片：删除时一并清理，元数据失败不阻断图片操作；
 * 删除时一次性算出作品封面回退值与角色封面回退值，避免前端二次推断后出现两套口径；
 * 图片只落 Images 一个目录，扫描与路径校验都不再考虑历史目录；
 * 手工放入的孤儿图可列举、可删除，但文件名不合法时不允许设为封面。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { readProjectSegments } from '@modules/common/projectPath'
import { buildStorageUri, deleteResource, toSafeSegments } from '@modules/common/storagePath'
import {
    isPressImageId,
    parseImageCharacterId,
    parseImageKind,
    parseImageLoreId,
    parseLoreImageKind,
    type ImageBatchDeleteResult,
    type ImageDeleteRequest,
    type ImageDeleteResult,
    type ImageDetailResult,
    type ImageLibraryResult,
    type ImageSetCoverResult,
    type PressImageItem,
    type PressImageKind,
} from '@shared/types/imagegen'
import type { PressLoreKind } from '@shared/types/press'
import { IMAGES_DIR } from './constants'
import { isProjectImagePath, readImageIdFromPath } from './db/coverRepository'
import { listImageFiles } from './imageDirScan'
import { deleteSidecarOf } from './imageSidecar'
import { readProjectDirPath } from './portraitService'
import type { PressCoverStore } from './db/coverRepository'

/** 文件名去掉扩展名 */
const EXTENSION_PATTERN = /\.[^.]+$/u
/** 图片标识中的 14 位时间戳：新命名在第 2 段，旧命名在末段 */
const TIMESTAMP_PATTERN = /(?:^|-)(\d{14})(?:-|$)/u
/** 路径长度上限：前端传入的相对路径不应有过长值 */
const MAX_PATH_LENGTH = 512
/** 单次批量删除的张数上限：防止一次请求占用过久，也避免前端误传超大数组 */
const MAX_BATCH_DELETE = 500

/** 从图片标识解析生成时间：解析失败返回 null，由调用方回落到文件修改时间 */
function readTimestampFromId(id: string): string | null {
    const matched = TIMESTAMP_PATTERN.exec(id)
    if (matched?.[1] === undefined) {
        return null
    }
    const stamp = matched[1]
    const year = Number(stamp.slice(0, 4))
    const month = Number(stamp.slice(4, 6))
    const day = Number(stamp.slice(6, 8))
    const hour = Number(stamp.slice(8, 10))
    const minute = Number(stamp.slice(10, 12))
    const second = Number(stamp.slice(12, 14))
    const date = new Date(year, month - 1, day, hour, minute, second)
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour
    ) {
        return null
    }
    return date.toISOString()
}

/** 读取前端传入的图片相对路径：类型、长度与空值在这一层收窄 */
function readImagePath(payload: unknown, method: string): string {
    const record = payload as ImageDeleteRequest | { path?: unknown } | null
    const value = record?.path
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
        throw new Error(`${method} 缺少图片路径`)
    }
    return value
}

/** 侧车字段读取：只接受非空字符串，数字、对象与 null 一律视为缺失 */
function readMetaText(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

export class ImageLibraryService {
    public constructor(private readonly store: PressCoverStore) {}

    /**
     * 列举作品下的全部图片：合并统一目录与两个旧目录，按生成时间降序（最新在前）。
     * 关键约束：单个目录或单张图片读取失败不抛错，避免并发删除导致整页列举失败。
     */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<ImageLibraryResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/listImageLibrary')
        const images = await this.scan(readProjectSegments(dirPath), toWebviewUri)
        return this.buildLibrary(dirPath, images)
    }

    /** 用已扫描出的图片组装列表：counts 与封面指针都从这份数据推导，避免为同一结果重复读盘 */
    private buildLibrary(dirPath: string, images: PressImageItem[]): ImageLibraryResult {
        const selected = this.store.read(dirPath)
        const counts: Record<PressImageKind, number> = { portrait: 0, lore: 0, photo: 0, orphan: 0 }
        for (const image of images) {
            counts[image.kind] += 1
        }
        return {
            images,
            coverSelectedId: selected === null ? null : readImageIdFromPath(selected),
            counts,
        }
    }

    /**
     * 删除一张图片：先校验归属，再回收站，最后修作品封面指针并算出角色封面回退值。
     * 关键约束：被删图若是作品封面，回退到剩余最新一张；角色封面回退由调用方按 nextPortraitId 写回。
     */
    public async remove(payload: unknown): Promise<ImageDeleteResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/deleteImage')
        const path = readImagePath(payload, 'pressAi/deleteImage')
        if (!isProjectImagePath(dirPath, path)) {
            throw new Error(`图片路径非法：${path}`)
        }
        const id = readImageIdFromPath(path)
        const characterId = parseImageCharacterId(id)
        const loreId = parseImageLoreId(id)
        const loreKind = parseLoreImageKind(id)
        const selected = this.store.read(dirPath)
        const currentCoverId = selected === null ? null : readImageIdFromPath(selected)
        const target = buildStorageUri(resolveStorageRoot(), toSafeSegments(path, '图片'))
        try {
            await deleteResource(target, false)
        } catch {
            logger.warn(`图片删除失败：${path}`)
            return {
                removed: false,
                coverSelectedId: currentCoverId,
                characterId,
                nextPortraitId: null,
                loreId,
                loreKind,
                nextLoreImageId: null,
            }
        }
        // 侧车与图片同生共死：图片进回收站后元数据已无意义，直接清掉，失败不影响删除结果
        await deleteSidecarOf(target)
        const rest = await this.scan(readProjectSegments(dirPath), () => '')
        let coverSelectedId = currentCoverId
        if (selected === path) {
            const nextPath = rest[0]?.path ?? null
            this.store.write(dirPath, nextPath)
            coverSelectedId = nextPath === null ? null : readImageIdFromPath(nextPath)
        }
        const nextPortraitId = characterId === null ? null : this.pickLatestByCharacter(rest, characterId)
        const nextLoreImageId = loreId === null ? null : this.pickLatestByLore(rest, loreId)
        logger.info(`图片已删除：${path}`)
        return { removed: true, coverSelectedId, characterId, nextPortraitId, loreId, loreKind, nextLoreImageId }
    }

    /**
     * 批量删除：整单校验路径后逐张删除，最后只重扫一次目录并直接返回新图库。
     * 关键约束：任一路径不属于该作品即整单拒绝，不执行部分删除；单张失败只记回执、不中断整批；
     * 若删掉的正是作品封面，指针回退到剩余最新一张，并在重扫后随新图库一并返回，
     * 前端无需再发列举请求，也不会出现「同一批删除 N 次全量扫描」的开销。
     */
    public async batchRemove(
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<ImageBatchDeleteResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/deleteImages')
        const record = payload as { paths?: unknown } | null
        const rawPaths = Array.isArray(record?.paths) ? record.paths : []
        const paths = rawPaths.filter((item): item is string => typeof item === 'string' && item.length > 0)
        if (paths.length === 0) {
            throw new Error('缺少待删除的图片路径')
        }
        if (paths.length > MAX_BATCH_DELETE) {
            throw new Error(`一次最多删除 ${MAX_BATCH_DELETE} 张图片`)
        }
        const uniquePaths = [...new Set(paths)]
        for (const path of uniquePaths) {
            if (!isProjectImagePath(dirPath, path)) {
                throw new Error(`图片路径非法：${path}`)
            }
        }
        const root = resolveStorageRoot()
        const removals: { path: string; removed: boolean }[] = []
        for (const path of uniquePaths) {
            const target = buildStorageUri(root, toSafeSegments(path, '图片'))
            try {
                await deleteResource(target, false)
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                logger.warn(`批量删除中的单张失败：${path}（${reason}）`)
                removals.push({ path, removed: false })
                continue
            }
            await deleteSidecarOf(target)
            removals.push({ path, removed: true })
        }
        const rest = await this.scan(readProjectSegments(dirPath), toWebviewUri)
        const selected = this.store.read(dirPath)
        if (selected !== null && uniquePaths.includes(selected)) {
            this.store.write(dirPath, rest[0]?.path ?? null)
        }
        const removedCount = removals.filter((item) => item.removed).length
        logger.info(`批量删除完成：成功 ${removedCount} 张，失败 ${removals.length - removedCount} 张`)
        return { removals, library: this.buildLibrary(dirPath, rest) }
    }

    /** 设为作品封面：校验归属、标识合法与文件存在后再写库 */
    public async setCover(payload: unknown): Promise<ImageSetCoverResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/setImageCover')
        const path = readImagePath(payload, 'pressAi/setImageCover')
        if (!isProjectImagePath(dirPath, path)) {
            throw new Error(`图片路径非法：${path}`)
        }
        const id = readImageIdFromPath(path)
        if (!isPressImageId(id)) {
            throw new Error('该图片不是标准命名，无法设为封面')
        }
        const target = buildStorageUri(resolveStorageRoot(), toSafeSegments(path, '图片'))
        try {
            await vscode.workspace.fs.stat(target)
        } catch {
            throw new Error('图片文件已不存在，请刷新列表')
        }
        this.store.write(dirPath, path)
        logger.info(`作品封面已更新：${path}`)
        return { coverSelectedId: id }
    }

    /**
     * 读取图片的出图参数快照（同名侧车）：旧图没有侧车时各项返回 null，不报错。
     * 关键约束：路径需通过作品归属校验；侧车内容按未知输入处理，字段类型不符即丢弃；
     * 只读侧车、不校验图片是否存在——图片刚被删时详情面板也应拿到可读的降级结果。
     */
    public async readDetail(payload: unknown): Promise<ImageDetailResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/getImageDetail')
        const path = readImagePath(payload, 'pressAi/getImageDetail')
        if (!isProjectImagePath(dirPath, path)) {
            throw new Error(`图片路径非法：${path}`)
        }
        const id = readImageIdFromPath(path)
        const segments = toSafeSegments(path, '图片')
        const target = buildStorageUri(resolveStorageRoot(), [...segments.slice(0, -1), `${id}.json`])
        const empty: ImageDetailResult = {
            prompt: null,
            ratio: null,
            style: null,
            characterId: null,
            loreId: null,
            loreKind: null,
            enhancedFrom: null,
            createdAt: null,
        }
        let raw: string
        try {
            const bytes = await vscode.workspace.fs.readFile(target)
            raw = Buffer.from(bytes).toString('utf8')
        } catch {
            // 旧图没有侧车：按无参数处理，详情面板隐藏参数区
            return empty
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            logger.warn(`图片侧车不是合法 JSON：${id}`)
            return empty
        }
        const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
        // 旧侧车没有条目字段：缺失即按「不是条目图」处理
        const loreKindValue = readMetaText(record.loreKind)
        const loreKind: PressLoreKind | null =
            loreKindValue === 'faction' || loreKindValue === 'place' || loreKindValue === 'item' ? loreKindValue : null
        return {
            prompt: readMetaText(record.prompt),
            ratio: readMetaText(record.ratio),
            style: readMetaText(record.style),
            characterId: readMetaText(record.characterId),
            loreId: readMetaText(record.loreId),
            loreKind,
            enhancedFrom: readMetaText(record.enhancedFrom),
            createdAt: readMetaText(record.createdAt),
        }
    }

    /** 在已列举结果中取某角色最新一张图：列表已按时间降序，首个命中即最新 */
    private pickLatestByCharacter(images: PressImageItem[], characterId: string): string | null {
        const matched = images.find((image) => image.characterId === characterId)
        return matched?.id ?? null
    }

    /** 在已列举结果中取某条目最新一张图：列表已按时间降序，首个命中即最新 */
    private pickLatestByLore(images: PressImageItem[], loreId: string): string | null {
        const matched = images.find((image) => image.loreId === loreId)
        return matched?.id ?? null
    }

    /**
     * 扫描统一图片目录并按生成时间降序排列。
     * 时间来源：优先取文件名中的 14 位时间戳，取不到再读文件修改时间，都失败则排到最后。
     */
    private async scan(
        projectSegments: string[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PressImageItem[]> {
        const images: PressImageItem[] = []
        for (const file of await listImageFiles(projectSegments, IMAGES_DIR)) {
            const id = file.name.replace(EXTENSION_PATTERN, '')
            images.push({
                id,
                kind: isPressImageId(id) ? parseImageKind(id) : 'orphan',
                path: file.segments.join('/'),
                url: toWebviewUri(file.uri),
                createdAt: await this.readCreatedAt(file.uri, id),
                characterId: parseImageCharacterId(id),
                loreId: parseImageLoreId(id),
                loreKind: parseLoreImageKind(id),
            })
        }
        images.sort((left, right) => {
            const byTime = right.createdAt.localeCompare(left.createdAt)
            return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
        })
        return images
    }

    /** 生成时间：文件名时间戳优先，读不到时回落到文件修改时间 */
    private async readCreatedAt(uri: vscode.Uri, id: string): Promise<string> {
        const fromId = readTimestampFromId(id)
        if (fromId !== null) {
            return fromId
        }
        try {
            const stat = await vscode.workspace.fs.stat(uri)
            return new Date(stat.mtime).toISOString()
        } catch {
            return new Date(0).toISOString()
        }
    }
}
