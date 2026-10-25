/**
 * 图片库服务：按作品把统一目录 Images（兼容旧 Cover / Portraits）中的图片聚合为一份可管理列表，
 * 提供列举、删除、设为作品封面与旧目录迁移四项能力，是图片总览页与角色卡页共用的唯一数据入口。
 * 复用约定：目录名取自 ./constants，路径归属校验复用 ./db/coverRepository 的 isProjectImagePath，
 * 封面指针沿用 PressCoverStore（press.db 的 meta 表），作品目录归一复用 ../common/projectPath。
 * 关键约束：磁盘是唯一事实来源，任何写操作后都按目录重扫，不维护内存缓存；
 * 删除时一次性算出作品封面回退值与角色封面回退值，避免前端二次推断后出现两套口径；
 * 手工放入的孤儿图可列举、可删除，但文件名不合法时不允许设为封面；
 * 旧目录迁移只搬文件、不改名，并同步改写作品封面指针的目录前缀。
 */
import * as vscode from 'vscode'
import { IMAGES_DIR, IMAGE_DIR_NAMES } from './constants'
import { isProjectImagePath, readImageIdFromPath } from './db/coverRepository'
import { readProjectDirPath } from './portraitService'
import type { PressCoverStore } from './db/coverRepository'
import {
    isPressImageId,
    parseImageCharacterId,
    parseImageKind,
    type ImageDeleteRequest,
    type ImageDeleteResult,
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

/** 列举只认图片文件，其余一律忽略 */
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp)$/i
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
        let moved = 0
        let skipped = 0
        for (const dirName of IMAGE_DIR_NAMES) {
            if (dirName === IMAGES_DIR) {
                continue
            }
            const dirSegments = [...projectSegments, dirName]
            let entries: [string, vscode.FileType][]
            try {
                entries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, dirSegments))
            } catch {
                // 旧目录不存在：无需迁移
                continue
            }
            for (const [name, type] of entries) {
                if (type !== vscode.FileType.File || !IMAGE_FILE_PATTERN.test(name)) {
                    continue
                }
                const target = buildStorageUri(root, [...imagesSegments, name])
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
                    await vscode.workspace.fs.rename(buildStorageUri(root, [...dirSegments, name]), target, {
                        overwrite: false,
                    })
                    moved += 1
                } catch {
                    logger.warn(`旧目录图片迁移失败：${dirName}/${name}`)
                    skipped += 1
                }
            }
        }
        const selected = this.store.read(dirPath)
        const hasLegacyCover = selected !== null && !selected.startsWith(`${IMAGES_DIR}/`)
        if (hasLegacyCover) {
            const fileName = selected.slice(selected.lastIndexOf('/') + 1)
            this.store.write(dirPath, `${IMAGES_DIR}/${fileName}`)
        }
        logger.info(`旧目录迁移完成：移动 ${moved} 张，跳过 ${skipped} 张，封面指针改写 ${hasLegacyCover}`)
        return { moved, skipped, coverUpdated: hasLegacyCover }
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
        const root = resolveStorageRoot()
        const images: PressImageItem[] = []
        for (const dirName of IMAGE_DIR_NAMES) {
            const dirSegments = [...projectSegments, dirName]
            let entries: [string, vscode.FileType][]
            try {
                entries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, dirSegments))
            } catch {
                // 该目录尚未创建，或旧目录迁移后已清空
                continue
            }
            for (const [name, type] of entries) {
                if (type !== vscode.FileType.File || !IMAGE_FILE_PATTERN.test(name)) {
                    continue
                }
                const id = name.replace(EXTENSION_PATTERN, '')
                const segments = [...dirSegments, name]
                const uri = buildStorageUri(root, segments)
                images.push({
                    id,
                    kind: isPressImageId(id) ? parseImageKind(id) : 'orphan',
                    path: segments.join('/'),
                    url: toWebviewUri(uri),
                    createdAt: await this.readCreatedAt(uri, id),
                    characterId: parseImageCharacterId(id),
                })
            }
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
