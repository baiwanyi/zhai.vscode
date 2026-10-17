/**
 * 作品服务：把新作品骨架或新章节落到 press/ 目录并纳入索引，或按作品/章节路径打开对应文档。
 * 复用 common/storagePath 的路径构造与片段校验、common/config 的存储根解析、IndexService 的单文件索引能力。
 * 关键约束：落盘前校验作品名、目标目录与文件名存在性，已存在即报错、绝不覆盖；写入后立即索引，
 * 使列表不等 watcher 防抖即可见；实现路径统一为「press/{作品名}」两段，章节须位于其 Chapter/ 之下，
 * 存在性由调用方按索引库回查。
 */
import * as vscode from 'vscode'
import {
    PROJECT_CHAPTER_DIR,
    PROJECT_README_NAME,
    PRESS_MODULE_DIR,
    buildChapterFileName,
    buildChapterSkeleton,
    buildChapterTitle,
    buildProjectSkeleton,
    compareByOrder,
    readOrderPrefix,
    toDisplayName,
    validateProjectName,
} from './projectFactory'
import type { PressCategory } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '../common/storagePath'

/** 新建章节的序号冲突重试上限 */
const MAX_CHAPTER_ATTEMPTS = 10

/** 新建作品所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface ProjectIndexer {
    indexFile: (uri: vscode.Uri) => Promise<void>
}

/** 新建作品入参：分类已由调用方归一化为枚举值 */
export interface CreateProjectRequest {
    name: string
    category: PressCategory
}

/** 新建结果：额外携带 README 的 Uri 供调用方直接打开，返回给 Webview 时只取可序列化字段 */
export interface CreatedProjectHandle {
    dirPath: string
    title: string
    readmeUri: vscode.Uri
}

/**
 * 在 press/ 下新建作品骨架并立即索引。
 * 关键约束：作品名 trim 后再校验；目标目录已存在即拒绝，避免覆盖用户已有内容；
 * Chapter/ 为空目录（无文档时不进索引），作品仍以 README 等骨架文档出现在列表中。
 */
export async function createProject(
    indexer: ProjectIndexer,
    request: CreateProjectRequest,
): Promise<CreatedProjectHandle> {
    const name = request.name.trim()
    const invalidReason = validateProjectName(name)
    if (invalidReason !== null) {
        throw new Error(invalidReason)
    }
    const root = resolveStorageRoot()
    const directory = buildStorageUri(root, [PRESS_MODULE_DIR, name])
    if (await isPathExisting(directory)) {
        throw new Error(`作品已存在：${name}`)
    }
    await vscode.workspace.fs.createDirectory(directory)
    await vscode.workspace.fs.createDirectory(buildStorageUri(root, [PRESS_MODULE_DIR, name, PROJECT_CHAPTER_DIR]))
    for (const file of buildProjectSkeleton(name, request.category, new Date())) {
        const target = buildStorageUri(root, [PRESS_MODULE_DIR, name, ...file.relativePath.split('/')])
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(file.content))
        await indexer.indexFile(target)
    }
    logger.info(`已创建作品：${PRESS_MODULE_DIR}/${name}`)
    return {
        dirPath: `${PRESS_MODULE_DIR}/${name}`,
        title: name,
        readmeUri: buildStorageUri(root, [PRESS_MODULE_DIR, name, PROJECT_README_NAME]),
    }
}

/** 新增章节入参：章节路径清单由调用方按索引库提供，服务本身不直接依赖数据库 */
export interface CreateChapterRequest {
    dirPath: string
    /** 该作品已登记的章节相对路径，用于计算下一个序号与落点卷 */
    chapterPaths: string[]
}

/** 新增章节结果：额外携带 Uri 供调用方打开，返回给 Webview 时只取可序列化字段 */
export interface CreatedChapterHandle {
    path: string
    title: string
    volume: string
    uri: vscode.Uri
}

/** 落点决策：目标卷目录（null 表示 Chapter/ 根）与此后的起始序号 */
interface ChapterPlacement {
    volumeDir: string | null
    volumeName: string
    startOrder: number
}

/**
 * 校验并切分作品目录：先归一化再校验片段，且必须恰好是 press/{作品名} 两段。
 * 安全约束：从源头排除越出 press 模块、上跳或指向其他模块目录的路径。
 */
function readProjectSegments(dirPath: string): string[] {
    const segments = toSafeSegments(toStorageRelativePath(dirPath, '作品'), '作品')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品路径非法：${dirPath}`)
    }
    return segments
}

/**
 * 计算新章节的落点：有分卷时追加到序号最大的卷，否则落在 Chapter/ 根；序号取该落点的最大章节序号 + 1。
 * 关键约束：序号完全依据索引库口径推导，未索引的手工文件不参与编号，冲突由写入前的存在性检查兜底。
 */
function resolveChapterPlacement(dirPath: string, chapterPaths: string[]): ChapterPlacement {
    const chapterRoot = `${dirPath}/${PROJECT_CHAPTER_DIR}/`
    const volumeMaxOrders = new Map<string, number>()
    let rootMaxOrder = 0
    for (const path of chapterPaths) {
        if (!path.startsWith(chapterRoot)) {
            continue
        }
        const segments = path.slice(chapterRoot.length).split('/')
        const fileName = segments[segments.length - 1]
        if (fileName === undefined || !fileName.toLowerCase().endsWith('.md')) {
            continue
        }
        const order = readOrderPrefix(fileName)
        if (segments.length === 1) {
            if (order !== null && order > rootMaxOrder) {
                rootMaxOrder = order
            }
            continue
        }
        const volumeDir = segments[0]
        if (volumeDir === undefined || volumeDir.length === 0) {
            continue
        }
        const current = volumeMaxOrders.get(volumeDir) ?? 0
        if (order !== null && order > current) {
            volumeMaxOrders.set(volumeDir, order)
        } else if (!volumeMaxOrders.has(volumeDir)) {
            volumeMaxOrders.set(volumeDir, current)
        }
    }
    if (volumeMaxOrders.size === 0) {
        return { volumeDir: null, volumeName: '', startOrder: rootMaxOrder + 1 }
    }
    const sortedVolumes = [...volumeMaxOrders.keys()].sort((left, right) =>
        compareByOrder(
            { order: readOrderPrefix(left), name: toDisplayName(left) },
            { order: readOrderPrefix(right), name: toDisplayName(right) },
        ),
    )
    const targetVolume = sortedVolumes[sortedVolumes.length - 1]
    if (targetVolume === undefined) {
        return { volumeDir: null, volumeName: '', startOrder: rootMaxOrder + 1 }
    }
    return {
        volumeDir: targetVolume,
        volumeName: toDisplayName(targetVolume),
        startOrder: (volumeMaxOrders.get(targetVolume) ?? 0) + 1,
    }
}

/**
 * 打开作品的 README.md：不移动光标，交由编辑器以独立标签展示。
 * 安全约束：入参须为 press/{作品名} 两段，存在性由调用方按索引库回查。
 */
export async function openProjectByDir(dirPath: string): Promise<void> {
    const root = resolveStorageRoot()
    const segments = readProjectSegments(dirPath)
    const readme = buildStorageUri(root, [...segments, PROJECT_README_NAME])
    const document = await vscode.workspace.openTextDocument(readme)
    await vscode.window.showTextDocument(document, { preview: false })
    logger.info(`已打开作品：${dirPath}`)
}

/**
 * 在作品末尾新增章节并立即索引：文件名与标题按两位序号生成，落点由 resolveChapterPlacement 决定。
 * 关键约束：目标文件名已存在时递增序号重试，绝不覆盖用户已有内容；目标目录缺失时先创建；
 * 写入后立即索引并返回相对路径，使详情页不等 watcher 防抖即可见新章节。
 */
export async function createChapter(
    indexer: ProjectIndexer,
    request: CreateChapterRequest,
): Promise<CreatedChapterHandle> {
    const segments = readProjectSegments(request.dirPath)
    const root = resolveStorageRoot()
    // 用归一化后的段拼装前缀，保证与索引库的相对路径口径一致
    const placement = resolveChapterPlacement(segments.join('/'), request.chapterPaths)
    const directorySegments = [
        ...segments,
        PROJECT_CHAPTER_DIR,
        ...(placement.volumeDir === null ? [] : [placement.volumeDir]),
    ]
    await vscode.workspace.fs.createDirectory(buildStorageUri(root, directorySegments))
    for (let attempt = 0; attempt < MAX_CHAPTER_ATTEMPTS; attempt += 1) {
        const order = placement.startOrder + attempt
        const fileName = buildChapterFileName(order)
        const target = buildStorageUri(root, [...directorySegments, fileName])
        if (await isPathExisting(target)) {
            logger.debug(`章节文件名冲突，尝试下一个序号：${fileName}`)
            continue
        }
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(buildChapterSkeleton(order)))
        await indexer.indexFile(target)
        const relativePath = [...directorySegments, fileName].join('/')
        logger.info(`已新增章节：${relativePath}`)
        return { path: relativePath, title: buildChapterTitle(order), volume: placement.volumeName, uri: target }
    }
    throw new Error(`新增章节失败：连续 ${MAX_CHAPTER_ATTEMPTS} 次序号冲突`)
}

/**
 * 打开指定章节文档：交由编辑器以独立标签展示，不移动光标。
 * 安全约束：入参先归一化与片段校验，且必须位于 press/{作品名}/Chapter/ 之下（未分卷 4 段、分卷 5 段起），
 * 存在性由调用方回查索引库。
 */
export async function openChapterByPath(indexPath: string): Promise<void> {
    const root = resolveStorageRoot()
    const segments = toSafeSegments(toStorageRelativePath(indexPath, '章节'), '章节')
    if (segments.length < 4 || segments[0] !== PRESS_MODULE_DIR || segments[2] !== PROJECT_CHAPTER_DIR) {
        throw new Error(`章节路径非法：${indexPath}`)
    }
    const uri = buildStorageUri(root, segments)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document, { preview: false })
    logger.info(`已打开章节：${indexPath}`)
}
