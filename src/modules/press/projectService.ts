/**
 * 作品服务：把新作品骨架或新章节落到 press/ 目录并纳入索引，或按作品/章节路径打开对应文档，
 * 并承担卷的重命名与删除、章节的删除与跨卷移动（保留或重排序号前缀、同步收敛索引）。
 * 复用 common/storagePath 的路径构造与片段校验、common/config 的存储根解析、IndexService 的单文件索引与前缀清理能力。
 * 关键约束：落盘前校验作品名、卷名、目标目录与文件名存在性，已存在即报错、绝不覆盖；写入后立即索引，
 * 使列表不等 watcher 防抖即可见；实现路径统一为「press/{作品名}」两段，章节须位于其 Chapters/ 之下，
 * 存在性由调用方按索引库回查；目录被移动或删除后主动按前缀清理索引，不依赖 watcher 的删除回调；
 * 删除统一走 common/storagePath 的 deleteResource（回收站优先，不可用时降级永久删除），本层不再直连 fs；
 * 旧作品的章节目录仍是 `Chapter`，任何写盘入口都先迁移，读取与校验则同时接受新旧两种目录名。
 */
import * as vscode from 'vscode'
import {
    CHAPTER_DIR_NAMES,
    DEFAULT_VOLUME_DIR,
    DEFAULT_VOLUME_ORDER,
    LEGACY_PROJECT_CHAPTER_DIR,
    PROJECT_CHAPTER_DIR,
    PROJECT_README_NAME,
    PRESS_MODULE_DIR,
    buildChapterFileName,
    buildChapterSkeleton,
    buildChapterTitle,
    buildDefaultVolumeName,
    buildOrderedChapterFileName,
    buildProjectSkeleton,
    buildRenamedVolumeDirName,
    buildVolumeDirName,
    compareByOrder,
    readOrderPrefix,
    toDisplayName,
    validateProjectName,
    validateVolumeName,
} from './projectFactory'
import type { PressAudience } from '../../shared/types/press'
import type { DeleteOutcome } from '../common/storagePath'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import {
    buildStorageUri,
    deleteResource,
    isPathExisting,
    toSafeSegments,
    toStorageRelativePath,
} from '../common/storagePath'

/** 新建章节的序号冲突重试上限 */
const MAX_CHAPTER_ATTEMPTS = 10

/** 作品与卷操作所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface ProjectIndexer {
    indexFile: (uri: vscode.Uri) => Promise<void>
    /** 删除指定相对前缀下的索引记录，卷重命名或删除后收敛，避免列表残留 */
    removeFilesUnder: (relativePrefix: string) => void
    /** 删除单份文档的索引记录，章节删除或跨卷移动后收敛 */
    removeFile: (relativePath: string) => void
}

/** 新建作品入参：目标读者已由调用方归一化为枚举值 */
export interface CreateProjectRequest {
    name: string
    audience: PressAudience
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
 * 骨架自带默认卷与首章（作品内容为空时默认就是「默认卷 / 01-未命名章节」），目录须先建好再写文件。
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
    // 作品天生带一卷：章节一律落在卷下，避免出现根目录散章
    await vscode.workspace.fs.createDirectory(
        buildStorageUri(root, [PRESS_MODULE_DIR, name, PROJECT_CHAPTER_DIR, DEFAULT_VOLUME_DIR]),
    )
    for (const file of buildProjectSkeleton(name, request.audience, new Date())) {
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
    /** 落点卷目录名；缺省时落到序号最大的卷，作品还没有卷时落到自动创建的默认卷 */
    volumeDir?: string
}

/** 新增章节结果：额外携带 Uri 供调用方打开，返回给 Webview 时只取可序列化字段 */
export interface CreatedChapterHandle {
    path: string
    title: string
    volume: string
    uri: vscode.Uri
}

/** 新建卷入参：章节路径清单用于推导新卷序号 */
export interface CreateVolumeRequest {
    dirPath: string
    chapterPaths: string[]
}

/** 新建卷结果：卷目录、卷名与该卷首章（首章保证空卷也能进入索引与列表） */
export interface CreatedVolumeHandle {
    volumeDir: string
    volumeName: string
    chapterPath: string
    chapterTitle: string
    uri: vscode.Uri
}

/** 卷重命名入参：新卷名只替换可读部分，序号前缀由服务按原目录保留 */
export interface RenameVolumeRequest {
    dirPath: string
    /** 当前卷目录名（含序号前缀） */
    volumeDir: string
    /** 新卷名，不含序号前缀 */
    name: string
    /** 该卷已登记的文档路径，重命名后据此按新路径重建索引 */
    volumeFilePaths: string[]
}

/** 卷重命名结果：新卷目录名与展示名，供前端定位该卷 */
export interface RenamedVolumeHandle {
    volumeDir: string
    volumeName: string
}

/** 卷删除入参：卷目录名（含序号前缀） */
export interface DeleteVolumeRequest {
    dirPath: string
    volumeDir: string
}

/** 整部作品删除入参：作品目录 */
export interface DeleteProjectRequest {
    dirPath: string
}

/** 章节删除入参：章节相对路径 */
export interface DeleteChapterRequest {
    dirPath: string
    path: string
}

/** 章节移动入参：目标卷与作品已登记的章节路径（后者用于按目标卷推导新序号） */
export interface MoveChapterRequest {
    dirPath: string
    path: string
    /** 目标卷目录名；空串表示移到未分卷的 Chapters/ 根目录 */
    targetVolumeDir: string
    /** 该作品已登记的章节路径，用于计算目标任务卷内的下一个序号 */
    chapterPaths: string[]
}

/** 章节移动结果：额外携带 Uri 供调用方按需打开，返回给 Webview 时只取可序列化字段 */
export interface MovedChapterHandle {
    path: string
    title: string
    volume: string
    uri: vscode.Uri
}

/** 落点决策：目标卷目录、卷名与该卷内的起始章序号 */
interface ChapterPlacement {
    volumeDir: string
    volumeName: string
    startOrder: number
}

/** 卷目录名 → 该卷已登记章节的最大序号（无序号前缀记为 0） */
type VolumeMaxOrders = Map<string, number>

/**
 * 校验并切分作品目录：先归一化再校验片段，且必须恰好是 press/{作品名} 两段。
 * 安全约束：从源头排除越出 press 模块、上跳或指向其他模块目录的路径。
 * 复用约定：角色卡目录、工作台文档读取等按作品定位的模块共用本函数，不各自实现路径校验。
 */
export function readProjectSegments(dirPath: string): string[] {
    const segments = toSafeSegments(toStorageRelativePath(dirPath, '作品'), '作品')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品路径非法：${dirPath}`)
    }
    return segments
}

/**
 * 迁移旧版章节目录：把作品下的 `Chapter` 整体重命名为 Chapters。
 * 关键约束：只在新目录不存在、旧目录存在时动盘——新目录已存在说明此前迁移过，不碰旧目录；
 * 重命名失败只记日志、不抛错，读取与索引仍兼容旧目录，用户可重试；
 * 迁移后索引里的旧路径由 watcher 的删除回调自然清理，本函数不直接改索引库。
 * @param dirPath 作品目录，形如 press/{作品名}
 */
export async function migrateLegacyChapterDirectory(dirPath: string): Promise<void> {
    const segments = readProjectSegments(dirPath)
    const root = resolveStorageRoot()
    const target = buildStorageUri(root, [...segments, PROJECT_CHAPTER_DIR])
    if (await isPathExisting(target)) {
        return
    }
    const legacy = buildStorageUri(root, [...segments, LEGACY_PROJECT_CHAPTER_DIR])
    if (!(await isPathExisting(legacy))) {
        return
    }
    try {
        await vscode.workspace.fs.rename(legacy, target, { overwrite: false })
        logger.info(`章节目录已迁移：${dirPath}（${LEGACY_PROJECT_CHAPTER_DIR} → ${PROJECT_CHAPTER_DIR}）`)
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        logger.warn(`章节目录迁移失败，继续读取旧目录：${dirPath}，原因：${detail}`)
    }
}

/** 章节路径相对作品目录的部分：新旧章节目录名都认，迁移前旧作品仍能正确取到卷与章 */
function readChapterRelativePath(dirPath: string, path: string): string | null {
    for (const chapterDirName of CHAPTER_DIR_NAMES) {
        const prefix = `${dirPath}/${chapterDirName}/`
        if (path.startsWith(prefix)) {
            return path.slice(prefix.length)
        }
    }
    return null
}

/**
 * 统计每个卷内的最大章序号：只认 Chapters/ 下「卷/章」两段以上的路径，
 * 根目录散章（历史数据）不参与卷内编号。
 */
function collectVolumeMaxOrders(dirPath: string, chapterPaths: string[]): VolumeMaxOrders {
    const volumeMaxOrders: VolumeMaxOrders = new Map()
    for (const path of chapterPaths) {
        const relativePath = readChapterRelativePath(dirPath, path)
        if (relativePath === null) {
            continue
        }
        const segments = relativePath.split('/')
        if (segments.length < 2) {
            continue
        }
        const fileName = segments[segments.length - 1]
        if (fileName === undefined || !fileName.toLowerCase().endsWith('.md')) {
            continue
        }
        const volumeDir = segments[0]
        if (volumeDir === undefined || volumeDir.length === 0) {
            continue
        }
        const order = readOrderPrefix(fileName) ?? 0
        const current = volumeMaxOrders.get(volumeDir)
        if (current === undefined || order > current) {
            volumeMaxOrders.set(volumeDir, order)
        }
    }
    return volumeMaxOrders
}

/** 取序号最大的卷目录名：作品还没有卷时返回 undefined */
function pickLastVolume(volumeMaxOrders: VolumeMaxOrders): string | undefined {
    const sorted = [...volumeMaxOrders.keys()].sort((left, right) =>
        compareByOrder(
            { order: readOrderPrefix(left), name: toDisplayName(left) },
            { order: readOrderPrefix(right), name: toDisplayName(right) },
        ),
    )
    return sorted[sorted.length - 1]
}

/** 卷目录名合法性：单段、非空、不含分隔符与上跳片段 */
function readVolumeDir(volumeDir: string): string {
    const isUnsafe =
        volumeDir.length === 0 ||
        volumeDir === '.' ||
        volumeDir === '..' ||
        volumeDir.includes('/') ||
        volumeDir.includes('\\')
    if (isUnsafe) {
        throw new Error(`卷目录非法：${volumeDir}`)
    }
    return volumeDir
}

/**
 * 校验并切分章节路径：作品须为 press/{作品名} 两段，章节须在其实 Chapters/ 之下
 * （未分卷为 4 段、分卷为 5 段起，更深层级归入所在卷）。
 * 安全约束：先归一化再逐段校验，从源头排除上跳、跨作品与跨模块路径。
 */
function readChapterSegments(dirPath: string, chapterPath: string): string[] {
    const projectSegments = readProjectSegments(dirPath)
    const segments = toSafeSegments(toStorageRelativePath(chapterPath, '章节'), '章节')
    const isSameProject = projectSegments.every((segment, index) => segments[index] === segment)
    const chapterDirName = segments[2]
    const isChapterPath = chapterDirName !== undefined && CHAPTER_DIR_NAMES.includes(chapterDirName)
    if (!isSameProject || segments.length < 4 || !isChapterPath) {
        throw new Error(`章节路径非法：${chapterPath}`)
    }
    return segments
}

/** 章节所在卷目录名：未分卷散章返回空串，与卷分组的 dirName 口径一致 */
function readChapterVolumeDir(segments: string[]): string {
    return segments.length > 4 ? (segments[3] ?? '') : ''
}

/**
 * 取指定卷内的下一个可用章序号：空串代表未分卷散章。
 * 关键约束：只看该卷下的 .md 文档，无序号前缀的文件不参与编号，与新建章节的落点口径保持一致。
 */
function resolveNextChapterOrder(dirPath: string, chapterPaths: string[], volumeDir: string): number {
    let maxOrder = 0
    for (const path of chapterPaths) {
        const relativePath = readChapterRelativePath(dirPath, path)
        if (relativePath === null) {
            continue
        }
        const segments = relativePath.split('/')
        const fileName = segments[segments.length - 1]
        if (fileName === undefined || !fileName.toLowerCase().endsWith('.md')) {
            continue
        }
        const currentVolumeDir = segments.length > 1 ? (segments[0] ?? '') : ''
        if (currentVolumeDir !== volumeDir) {
            continue
        }
        const order = readOrderPrefix(fileName) ?? 0
        if (order > maxOrder) {
            maxOrder = order
        }
    }
    return maxOrder + 1
}

/**
 * 阻止删除有未保存修改的文档：磁盘文件被删后编辑器内容仍是脏的，用户一旦保存就会把文件写回，
 * 造成「已删除却复活」的错觉，因此要求先保存再删。
 */
function assertDocumentSaved(uri: vscode.Uri): void {
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
    if (opened !== undefined && opened.isDirty) {
        throw new Error(`章节有未保存的修改，请先保存再删除：${opened.uri.fsPath}`)
    }
}

/**
 * 计算新章节的落点：显式指定卷则用之；否则取序号最大的卷；作品还没有卷时落到自动创建的默认卷。
 * 关键约束：卷名须为单段且不含上跳片段，避免借卷名越出作品目录；序号取该卷内最大章序号 + 1，
 * 未索引的手工文件不参与编号，冲突由写入前的存在性检查兜底。
 */
function resolveChapterPlacement(dirPath: string, chapterPaths: string[], volumeDir?: string): ChapterPlacement {
    const volumeMaxOrders = collectVolumeMaxOrders(dirPath, chapterPaths)
    const target = readVolumeDir(volumeDir ?? pickLastVolume(volumeMaxOrders) ?? DEFAULT_VOLUME_DIR)
    return {
        volumeDir: target,
        volumeName: toDisplayName(target),
        startOrder: (volumeMaxOrders.get(target) ?? 0) + 1,
    }
}

/**
 * 打开作品的 README.md：不移动光标，交由编辑器以独立标签展示。
 * 安全约束：入参须为 press/{作品名} 两段，存在性由调用方按索引库回查。
 */
export async function openProjectByDir(dirPath: string): Promise<void> {
    // 打开即迁移旧章节目录：此后所有入口都按新目录读写，不会再出现两套目录并存
    await migrateLegacyChapterDirectory(dirPath)
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
    // 写盘前先迁移：旧目录还在时直接写新目录会留下两份章节树
    await migrateLegacyChapterDirectory(request.dirPath)
    const root = resolveStorageRoot()
    // 用归一化后的段拼装前缀，保证与索引库的相对路径口径一致
    const placement = resolveChapterPlacement(segments.join('/'), request.chapterPaths, request.volumeDir)
    const directorySegments = [...segments, PROJECT_CHAPTER_DIR, placement.volumeDir]
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
 * 新建一卷并立即写入该卷首章：卷序号取现有卷最大序号 + 1，卷名默认「默认卷」，重名时递增为「默认卷 2」「默认卷 3」。
 * 关键约束：索引库只记录文档，空目录不会出现在详情页，因此建卷必须伴随首章，避免产生「看不见的卷」；
 * 目标卷目录已存在时递增序号重试，绝不写入他人已有目录。
 */
export async function createVolume(
    indexer: ProjectIndexer,
    request: CreateVolumeRequest,
): Promise<CreatedVolumeHandle> {
    const segments = readProjectSegments(request.dirPath)
    await migrateLegacyChapterDirectory(request.dirPath)
    const root = resolveStorageRoot()
    const volumeMaxOrders = collectVolumeMaxOrders(segments.join('/'), request.chapterPaths)
    const existingVolumeDirs = [...volumeMaxOrders.keys()]
    const usedOrders = existingVolumeDirs
        .map((volumeDir) => readOrderPrefix(volumeDir))
        .filter((order): order is number => order !== null)
    const baseOrder = usedOrders.length === 0 ? DEFAULT_VOLUME_ORDER : Math.max(...usedOrders) + 1
    const existingNames = new Set(existingVolumeDirs.map((volumeDir) => toDisplayName(volumeDir)))
    const volumeName = buildDefaultVolumeName(existingNames)
    for (let attempt = 0; attempt < MAX_CHAPTER_ATTEMPTS; attempt += 1) {
        const order = baseOrder + attempt
        const volumeDir = buildVolumeDirName(order, volumeName)
        const directorySegments = [...segments, PROJECT_CHAPTER_DIR, volumeDir]
        const directory = buildStorageUri(root, directorySegments)
        if (await isPathExisting(directory)) {
            logger.debug(`卷目录已存在，尝试下一个序号：${volumeDir}`)
            continue
        }
        await vscode.workspace.fs.createDirectory(directory)
        const chapterName = buildChapterFileName(DEFAULT_VOLUME_ORDER)
        const target = buildStorageUri(root, [...directorySegments, chapterName])
        await vscode.workspace.fs.writeFile(
            target,
            new TextEncoder().encode(buildChapterSkeleton(DEFAULT_VOLUME_ORDER)),
        )
        await indexer.indexFile(target)
        const chapterPath = [...directorySegments, chapterName].join('/')
        logger.info(`已新建卷：${volumeDir}（首章 ${chapterPath}）`)
        return {
            volumeDir,
            volumeName: toDisplayName(volumeDir),
            chapterPath,
            chapterTitle: buildChapterTitle(DEFAULT_VOLUME_ORDER),
            uri: target,
        }
    }
    throw new Error(`新建卷失败：连续 ${MAX_CHAPTER_ATTEMPTS} 次目录名冲突`)
}

/**
 * 重命名一卷：只替换卷目录的可读部分，序号前缀沿用原目录，避免打乱卷的先后顺序。
 * 关键约束：新卷名须通过名称白名单校验；目标目录已存在即拒绝，绝不合并或覆盖已有内容；
 * 目录移动后旧路径索引立即失效，故先按旧前缀清理、再按新路径逐份索引，使列表不等 watcher 防抖即收敛。
 */
export async function renameVolume(
    indexer: ProjectIndexer,
    request: RenameVolumeRequest,
): Promise<RenamedVolumeHandle> {
    const segments = readProjectSegments(request.dirPath)
    await migrateLegacyChapterDirectory(request.dirPath)
    const currentDir = readVolumeDir(request.volumeDir)
    const name = request.name.trim()
    const invalidReason = validateVolumeName(name)
    if (invalidReason !== null) {
        throw new Error(invalidReason)
    }
    const volumeDir = buildRenamedVolumeDirName(currentDir, name)
    const volumeName = toDisplayName(volumeDir)
    // 可读部分未变时目录名不变，视为成功而非报错，便于前端统一按成功处理
    if (volumeDir === currentDir) {
        return { volumeDir, volumeName }
    }
    const root = resolveStorageRoot()
    const chapterRoot = [...segments, PROJECT_CHAPTER_DIR]
    const currentUri = buildStorageUri(root, [...chapterRoot, currentDir])
    const targetUri = buildStorageUri(root, [...chapterRoot, volumeDir])
    if (!(await isPathExisting(currentUri))) {
        throw new Error(`卷不存在：${currentDir}`)
    }
    if (await isPathExisting(targetUri)) {
        throw new Error(`卷已存在：${volumeDir}`)
    }
    await vscode.workspace.fs.rename(currentUri, targetUri, { overwrite: false })
    const currentPrefix = `${[...chapterRoot, currentDir].join('/')}/`
    // 先清旧路径记录，再按新路径建索引：两步顺序颠倒会让旧记录把新路径的聚合口径带偏
    indexer.removeFilesUnder(currentPrefix)
    const targetSegments = [...chapterRoot, volumeDir]
    for (const path of request.volumeFilePaths) {
        if (!path.startsWith(currentPrefix)) {
            continue
        }
        const relativeSegments = toSafeSegments(path.slice(currentPrefix.length), '章节')
        await indexer.indexFile(buildStorageUri(root, [...targetSegments, ...relativeSegments]))
    }
    logger.info(`已重命名卷：${currentDir} → ${volumeDir}`)
    return { volumeDir, volumeName }
}

/**
 * 删除一卷：整卷目录移入回收站（环境不支持时降级为永久删除，见 deleteResource），并同步清理该卷的索引记录。
 * 关键约束：递归删除目录时 watcher 不保证逐文件回调，必须按前缀主动清理，否则列表会残留已删章节；
 * 卷目录须为单段且位于 Chapters/ 之下，避免借卷名越出作品目录。
 */
export async function deleteVolume(indexer: ProjectIndexer, request: DeleteVolumeRequest): Promise<void> {
    const segments = readProjectSegments(request.dirPath)
    await migrateLegacyChapterDirectory(request.dirPath)
    const volumeDir = readVolumeDir(request.volumeDir)
    const root = resolveStorageRoot()
    const chapterRoot = [...segments, PROJECT_CHAPTER_DIR]
    const target = buildStorageUri(root, [...chapterRoot, volumeDir])
    if (!(await isPathExisting(target))) {
        throw new Error(`卷不存在：${volumeDir}`)
    }
    await deleteResource(target, true)
    indexer.removeFilesUnder(`${[...chapterRoot, volumeDir].join('/')}/`)
    logger.info(`已删除卷：${[...chapterRoot, volumeDir].join('/')}`)
}

/** 拒绝删除含未保存修改的作品：删盘后编辑器再保存会把文件写回来，索引与磁盘会长期不一致 */
function assertNoDirtyDocument(projectUri: vscode.Uri): void {
    const prefix = projectUri.path.endsWith('/') ? projectUri.path : `${projectUri.path}/`
    const dirty = vscode.workspace.textDocuments.find(
        (document) => document.isDirty && document.uri.path.startsWith(prefix),
    )
    if (dirty !== undefined) {
        throw new Error(`作品内有未保存的修改，请先保存再删除：${dirty.uri.path}`)
    }
}

/**
 * 删除整部作品：作品目录（README、设定、角色设定、大纲与全部章节）递归移入回收站，
 * 回收站不可用时降级为永久删除（见 deleteResource），随后按前缀清理该作品的索引记录。
 * 关键约束：目录须为 press/{作品名} 两段，避免借作品名删到模块根或别的作品；
 * 先拒绝有未保存修改的文档；递归删除不保证逐文件回调，必须主动清理索引，否则作品列表会残留；
 * 返回值须透传给前端，降级成功时不得再提示「可在回收站恢复」。
 */
export async function deleteProject(indexer: ProjectIndexer, request: DeleteProjectRequest): Promise<DeleteOutcome> {
    const segments = readProjectSegments(request.dirPath)
    const root = resolveStorageRoot()
    const target = buildStorageUri(root, segments)
    if (!(await isPathExisting(target))) {
        throw new Error(`作品不存在：${request.dirPath}`)
    }
    assertNoDirtyDocument(target)
    const outcome = await deleteResource(target, true)
    indexer.removeFilesUnder(`${segments.join('/')}/`)
    logger.info(`已删除作品：${segments.join('/')}（${outcome === 'trash' ? '回收站' : '永久删除'}）`)
    return outcome
}

/**
 * 删除单章：文档移入回收站（环境不支持时降级为永久删除，见 deleteResource），并同步清理该章的索引记录。
 * 关键约束：路径须落在该作品的 Chapters/ 之下（未分卷与分卷两种深度都接受），存在性由调用方回查索引库；
 * 有未保存修改的文档一律拒绝，避免删盘后编辑器内容「复活」文件。
 */
export async function deleteChapter(indexer: ProjectIndexer, request: DeleteChapterRequest): Promise<void> {
    const segments = readChapterSegments(request.dirPath, request.path)
    const root = resolveStorageRoot()
    const target = buildStorageUri(root, segments)
    if (!(await isPathExisting(target))) {
        throw new Error(`章节不存在：${request.path}`)
    }
    assertDocumentSaved(target)
    await deleteResource(target, false)
    indexer.removeFile(segments.join('/'))
    logger.info(`已删除章节：${segments.join('/')}`)
}

/**
 * 移动单章到另一卷末尾：只重排文件名序号，保留可读名与正文，随后按新路径收敛索引。
 * 关键约束：目标卷必须已存在（空目录不进索引，自动建卷会造出「看不见的卷」）；同卷移动直接拒绝；
 * 目标文件名冲突时递增序号重试，绝不覆盖既有章节；先删旧路径记录再索引新路径，避免旧记录带偏聚合口径。
 */
export async function moveChapter(indexer: ProjectIndexer, request: MoveChapterRequest): Promise<MovedChapterHandle> {
    const segments = readChapterSegments(request.dirPath, request.path)
    const root = resolveStorageRoot()
    const source = buildStorageUri(root, segments)
    const fileName = segments[segments.length - 1] ?? ''
    const currentVolumeDir = readChapterVolumeDir(segments)
    const targetVolumeDir = request.targetVolumeDir.length > 0 ? readVolumeDir(request.targetVolumeDir) : ''
    if (targetVolumeDir === currentVolumeDir) {
        throw new Error(`章节已在该卷：${toDisplayName(currentVolumeDir)}`)
    }
    if (!(await isPathExisting(source))) {
        throw new Error(`章节不存在：${request.path}`)
    }
    const chapterRoot = segments.slice(0, 3)
    const targetDirectorySegments = targetVolumeDir.length > 0 ? [...chapterRoot, targetVolumeDir] : chapterRoot
    const targetDirectory = buildStorageUri(root, targetDirectorySegments)
    if (targetVolumeDir.length > 0 && !(await isPathExisting(targetDirectory))) {
        throw new Error(`目标卷不存在：${targetVolumeDir}`)
    }
    const projectDirPath = segments.slice(0, 2).join('/')
    const startOrder = resolveNextChapterOrder(projectDirPath, request.chapterPaths, targetVolumeDir)
    const displayName = toDisplayName(fileName)
    for (let attempt = 0; attempt < MAX_CHAPTER_ATTEMPTS; attempt += 1) {
        const targetName = buildOrderedChapterFileName(startOrder + attempt, displayName)
        const target = buildStorageUri(root, [...targetDirectorySegments, targetName])
        if (await isPathExisting(target)) {
            logger.debug(`移动目标文件名冲突，尝试下一个序号：${targetName}`)
            continue
        }
        await vscode.workspace.fs.rename(source, target, { overwrite: false })
        const relativePath = [...targetDirectorySegments, targetName].join('/')
        indexer.removeFile(segments.join('/'))
        await indexer.indexFile(target)
        logger.info(`已移动章节：${segments.join('/')} → ${relativePath}`)
        return { path: relativePath, title: displayName, volume: toDisplayName(targetVolumeDir), uri: target }
    }
    throw new Error(`移动章节失败：连续 ${MAX_CHAPTER_ATTEMPTS} 次序号冲突`)
}

/**
 * 打开指定章节文档：交由编辑器以独立标签展示，不移动光标。
 * 安全约束：入参先归一化与片段校验，且必须位于 press/{作品名}/Chapters/ 之下（未分卷 4 段、分卷 5 段起），
 * 旧作品的 Chapters/ 路径一并接受，避免迁移未完成时打不开已索引的章节；存在性由调用方回查索引库。
 */
export async function openChapterByPath(indexPath: string): Promise<void> {
    const root = resolveStorageRoot()
    const segments = toSafeSegments(toStorageRelativePath(indexPath, '章节'), '章节')
    const chapterDirName = segments[2]
    const isChapterPath = chapterDirName !== undefined && CHAPTER_DIR_NAMES.includes(chapterDirName)
    if (segments.length < 4 || segments[0] !== PRESS_MODULE_DIR || !isChapterPath) {
        throw new Error(`章节路径非法：${indexPath}`)
    }
    const uri = buildStorageUri(root, segments)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document, { preview: false })
    logger.info(`已打开章节：${indexPath}`)
}
