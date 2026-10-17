/**
 * 作品服务：把新作品骨架或新章节落到 press/ 目录并纳入索引，或按作品/章节路径打开对应文档，
 * 并承担卷的重命名与删除、章节的删除与跨卷移动（保留或重排序号前缀、同步收敛索引）。
 * 复用 common/storagePath 的路径构造与片段校验、common/config 的存储根解析、IndexService 的单文件索引与前缀清理能力。
 * 关键约束：落盘前校验作品名、卷名、目标目录与文件名存在性，已存在即报错、绝不覆盖；写入后立即索引，
 * 使列表不等 watcher 防抖即可见；实现路径统一为「press/{作品名}」两段，章节须位于其 Chapter/ 之下，
 * 存在性由调用方按索引库回查；目录被移动或删除后主动按前缀清理索引，不依赖 watcher 的删除回调。
 */
import * as vscode from 'vscode'
import {
    DEFAULT_VOLUME_DIR,
    DEFAULT_VOLUME_ORDER,
    PROJECT_CHAPTER_DIR,
    PROJECT_README_NAME,
    PRESS_MODULE_DIR,
    buildChapterFileName,
    buildChapterSkeleton,
    buildChapterTitle,
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
import type { PressCategory } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '../common/storagePath'

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
    // 作品天生带一卷：章节一律落在卷下，避免出现根目录散章
    await vscode.workspace.fs.createDirectory(
        buildStorageUri(root, [PRESS_MODULE_DIR, name, PROJECT_CHAPTER_DIR, DEFAULT_VOLUME_DIR]),
    )
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
    /** 落点卷目录名；缺省时落到序号最大的卷，作品还没有卷时落到默认卷1 */
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

/** 章节删除入参：章节相对路径 */
export interface DeleteChapterRequest {
    dirPath: string
    path: string
}

/** 章节移动入参：目标卷与作品已登记的章节路径（后者用于按目标卷推导新序号） */
export interface MoveChapterRequest {
    dirPath: string
    path: string
    /** 目标卷目录名；空串表示移到未分卷的 Chapter/ 根目录 */
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
 */
function readProjectSegments(dirPath: string): string[] {
    const segments = toSafeSegments(toStorageRelativePath(dirPath, '作品'), '作品')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品路径非法：${dirPath}`)
    }
    return segments
}

/**
 * 统计每个卷内的最大章序号：只认 Chapter/ 下「卷/章」两段以上的路径，
 * 根目录散章（历史数据）不参与卷内编号。
 */
function collectVolumeMaxOrders(dirPath: string, chapterPaths: string[]): VolumeMaxOrders {
    const chapterRoot = `${dirPath}/${PROJECT_CHAPTER_DIR}/`
    const volumeMaxOrders: VolumeMaxOrders = new Map()
    for (const path of chapterPaths) {
        if (!path.startsWith(chapterRoot)) {
            continue
        }
        const segments = path.slice(chapterRoot.length).split('/')
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
 * 校验并切分章节路径：作品须为 press/{作品名} 两段，章节须在其实 Chapter/ 之下
 * （未分卷为 4 段、分卷为 5 段起，更深层级归入所在卷）。
 * 安全约束：先归一化再逐段校验，从源头排除上跳、跨作品与跨模块路径。
 */
function readChapterSegments(dirPath: string, chapterPath: string): string[] {
    const projectSegments = readProjectSegments(dirPath)
    const segments = toSafeSegments(toStorageRelativePath(chapterPath, '章节'), '章节')
    const isSameProject = projectSegments.every((segment, index) => segments[index] === segment)
    if (!isSameProject || segments.length < 4 || segments[2] !== PROJECT_CHAPTER_DIR) {
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
    const chapterRoot = `${dirPath}/${PROJECT_CHAPTER_DIR}/`
    let maxOrder = 0
    for (const path of chapterPaths) {
        if (!path.startsWith(chapterRoot)) {
            continue
        }
        const segments = path.slice(chapterRoot.length).split('/')
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
 * 计算新章节的落点：显式指定卷则用之；否则取序号最大的卷；作品还没有卷时落到默认卷1。
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
 * 新建一卷并立即写入该卷首章：卷序号取现有卷最大序号 + 1，目录名形如 03-卷3，首章为卷内 01 章。
 * 关键约束：索引库只记录文档，空目录不会出现在详情页，因此建卷必须伴随首章，避免产生「看不见的卷」；
 * 目标卷目录已存在时递增序号重试，绝不写入他人已有目录。
 */
export async function createVolume(
    indexer: ProjectIndexer,
    request: CreateVolumeRequest,
): Promise<CreatedVolumeHandle> {
    const segments = readProjectSegments(request.dirPath)
    const root = resolveStorageRoot()
    const volumeMaxOrders = collectVolumeMaxOrders(segments.join('/'), request.chapterPaths)
    const usedOrders = [...volumeMaxOrders.keys()]
        .map((volumeDir) => readOrderPrefix(volumeDir))
        .filter((order): order is number => order !== null)
    const baseOrder = usedOrders.length === 0 ? DEFAULT_VOLUME_ORDER : Math.max(...usedOrders) + 1
    for (let attempt = 0; attempt < MAX_CHAPTER_ATTEMPTS; attempt += 1) {
        const order = baseOrder + attempt
        const volumeDir = buildVolumeDirName(order)
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
 * 删除一卷：整卷目录移入回收站（环境不支持时退化为永久删除），并同步清理该卷的索引记录。
 * 关键约束：递归删除目录时 watcher 不保证逐文件回调，必须按前缀主动清理，否则列表会残留已删章节；
 * 卷目录须为单段且位于 Chapter/ 之下，避免借卷名越出作品目录。
 */
export async function deleteVolume(indexer: ProjectIndexer, request: DeleteVolumeRequest): Promise<void> {
    const segments = readProjectSegments(request.dirPath)
    const volumeDir = readVolumeDir(request.volumeDir)
    const root = resolveStorageRoot()
    const chapterRoot = [...segments, PROJECT_CHAPTER_DIR]
    const target = buildStorageUri(root, [...chapterRoot, volumeDir])
    if (!(await isPathExisting(target))) {
        throw new Error(`卷不存在：${volumeDir}`)
    }
    await vscode.workspace.fs.delete(target, { recursive: true, useTrash: true })
    indexer.removeFilesUnder(`${[...chapterRoot, volumeDir].join('/')}/`)
    logger.info(`已删除卷：${[...chapterRoot, volumeDir].join('/')}`)
}

/**
 * 删除单章：文档移入回收站（环境不支持时退化为永久删除），并同步清理该章的索引记录。
 * 关键约束：路径须落在该作品的 Chapter/ 之下（未分卷与分卷两种深度都接受），存在性由调用方回查索引库；
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
    await vscode.workspace.fs.delete(target, { recursive: false, useTrash: true })
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
