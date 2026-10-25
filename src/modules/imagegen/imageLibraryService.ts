/**
 * 图片库服务：按作品把统一目录 Images（兼容旧 Cover / Portraits）中的图片聚合为一份可管理列表，
 * 提供列举、删除、设为作品封面、旧目录迁移与侧车读取五项能力，是图片总览页与角色卡页共用的唯一数据入口。
 * 复用约定：目录名取自 ./constants，路径归属校验复用 ./db/coverRepository 的 isProjectImagePath，
 * 封面指针沿用 PressCoverStore（press.db 的 meta 表），作品目录归一复用 ../common/projectPath。
 * 关键约束：磁盘是唯一事实来源，任何写操作后都按目录重扫，不维护内存缓存；
 * 侧车 {id}.json 跟随图片：删除时一并清理、迁移时一并搬走，元数据失败不阻断图片操作；
 * 删除时一次性算出作品封面回退值与角色封面回退值，避免前端二次推断后出现两套口径；
 * 手工放入的孤儿图可列举、可删除，但文件名不合法时不允许设为封面；
 * 旧目录迁移只搬文件、不改名，并同步改写作品封面指针的目录前缀。
 */
import * as vscode from 'vscode'
import { IMAGES_DIR, IMAGE_DIR_NAMES } from './constants'
import { isProjectImagePath, readImageIdFromPath } from './db/coverRepository'
import { listImageFiles } from './imageDirScan'
import { deleteSidecarOf, moveSidecarOf } from './imageSidecar'
import { readProjectDirPath } from './portraitService'
import type { PressCoverStore } from './db/coverRepository'
import {
    isPressImageId,
    parseImageCharacterId,
    parseImageKind,
    type ImageDeleteRequest,
    type ImageDeleteResult,
    type ImageDetailResult,
    type ImageLibraryResult,
    type ImageMigrateResult,
    type ImageSetCoverResult,
    type PressImageItem,
    type PressImageKind,
} from '../../shared/types/imagegen'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { readProjectSegments } from '../common/projectPath'
import { buildStorageUri, deleteResource, toSafeSegments } from '../common/storagePath'

/** 文件名去掉扩展名 */
const EXTENSION_PATTERN = /\.[^.]+$/u
/** 图片标识中的 14 位时间戳：新命名在第 2 段，旧命名在末段 */
const TIMESTAMP_PATTERN = /(?:^|-)(\d{14})(?:-|$)/u
/** 路径长度上限：前端传入的相对路径不应有过长值 */
const MAX_PATH_LENGTH = 512

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
        const selected = this.store.read(dirPath)
        const counts: Record<PressImageKind, number> = { portrait: 0, photo: 0, orphan: 0 }
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
        const selected = this.store.read(dirPath)
        const currentCoverId = selected === null ? null : readImageIdFromPath(selected)
        const target = buildStorageUri(resolveStorageRoot(), toSafeSegments(path, '图片'))
        try {
            await deleteResource(target, false)
        } catch {
            logger.warn(`图片删除失败：${path}`)
            return { removed: false, coverSelectedId: currentCoverId, characterId, nextPortraitId: null }
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
        logger.info(`图片已删除：${path}`)
        return { removed: true, coverSelectedId, characterId, nextPortraitId }
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
     * 把旧目录（Cover / Portraits）里的图片搬进统一目录 Images。
     * 关键约束：不改文件名——图片标识即指针取值，改名会让作品封面与角色封面同时失效；
     * 目标已存在同名文件时跳过而不覆盖，两边都保留，交给用户取舍；
     * 迁移后只改写作品封面指针的目录前缀（角色封面存的是图片 id，不受目录影响）；
     * 全程逐文件容错：单张失败计入 skipped，不影响其余文件。
     */
    public async migrate(payload: unknown): Promise<ImageMigrateResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/migrateImageDirs')
        const projectSegments = readProjectSegments(dirPath)
        const root = resolveStorageRoot()
        const imagesSegments = [...projectSegments, IMAGES_DIR]
        const legacyDirNames = IMAGE_DIR_NAMES.filter((dirName) => dirName !== IMAGES_DIR)
        let moved = 0
        let skipped = 0
        for (const file of await listImageFiles(projectSegments, legacyDirNames)) {
            const target = buildStorageUri(root, [...imagesSegments, file.name])
            try {
                await vscode.workspace.fs.stat(target)
                // 目标已有同名文件：保留两侧，避免覆盖任一版本
                skipped += 1
                continue
            } catch {
                // 目标不存在，继续迁移
            }
            try {
                await vscode.workspace.fs.createDirectory(buildStorageUri(root, imagesSegments))
                await vscode.workspace.fs.rename(file.uri, target, { overwrite: false })
                // 侧车跟着图片走，否则迁移后的图在详情面板里丢参数，旧目录还会残留孤儿 JSON
                await moveSidecarOf(file.uri, target)
                moved += 1
            } catch {
                logger.warn(`旧目录图片迁移失败：${file.segments.join('/')}`)
                skipped += 1
            }
        }
        // 指针值形如 press/{作品名}/{目录}/{文件名}，前缀必须连作品段一起比对；
        // 只写「目录/文件名」会被 PressCoverStore 的归属校验拒绝，导致迁移在搬完图后整单失败
        const selected = this.store.read(dirPath)
        const imagesPrefix = [...projectSegments, IMAGES_DIR].join('/')
        const hasLegacyCover = selected !== null && !selected.startsWith(`${imagesPrefix}/`)
        if (hasLegacyCover) {
            const fileName = selected.slice(selected.lastIndexOf('/') + 1)
            this.store.write(dirPath, `${imagesPrefix}/${fileName}`)
        }
        logger.info(`旧目录迁移完成：移动 ${moved} 张，跳过 ${skipped} 张，封面指针改写 ${hasLegacyCover}`)
        return { moved, skipped, coverUpdated: hasLegacyCover }
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
        return {
            prompt: readMetaText(record.prompt),
            ratio: readMetaText(record.ratio),
            style: readMetaText(record.style),
            characterId: readMetaText(record.characterId),
            enhancedFrom: readMetaText(record.enhancedFrom),
            createdAt: readMetaText(record.createdAt),
        }
    }

    /** 在已列举结果中取某角色最新一张图：列表已按时间降序，首个命中即最新 */
    private pickLatestByCharacter(images: PressImageItem[], characterId: string): string | null {
        const matched = images.find((image) => image.characterId === characterId)
        return matched?.id ?? null
    }

    /**
     * 扫描三个图片目录并按生成时间降序排列。
     * 时间来源：优先取文件名中的 14 位时间戳，取不到再读文件修改时间，都失败则排到最后。
     */
    private async scan(
        projectSegments: string[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PressImageItem[]> {
        const images: PressImageItem[] = []
        for (const file of await listImageFiles(projectSegments, IMAGE_DIR_NAMES)) {
            const id = file.name.replace(EXTENSION_PATTERN, '')
            images.push({
                id,
                kind: isPressImageId(id) ? parseImageKind(id) : 'orphan',
                path: file.segments.join('/'),
                url: toWebviewUri(file.uri),
                createdAt: await this.readCreatedAt(file.uri, id),
                characterId: parseImageCharacterId(id),
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
