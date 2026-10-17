/**
 * 作品服务：把新作品骨架落到 press/ 目录并纳入索引，或按作品目录打开其 README.md。
 * 复用 common/storagePath 的路径构造与片段校验、common/config 的存储根解析、IndexService 的单文件索引能力。
 * 关键约束：落盘前校验作品名与目标目录存在性，已存在即报错、绝不覆盖；骨架逐文件写入后立即索引，
 * 使列表不等 watcher 防抖即可见；打开路径须严格为「press/{作品名}」两段，存在性由调用方按索引库回查。
 */
import * as vscode from 'vscode'
import {
    PROJECT_CHAPTER_DIR,
    PROJECT_README_NAME,
    PRESS_MODULE_DIR,
    buildProjectSkeleton,
    validateProjectName,
} from './projectFactory'
import type { PressCategory } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '../common/storagePath'

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

/**
 * 打开作品的 README.md：不移动光标，交由编辑器以独立标签展示。
 * 安全约束：入参先归一化为存储根口径的相对路径并做片段校验，且必须恰好是 press/{作品名} 两段，
 * 从源头排除越出 press 模块或指向其他模块目录的路径。
 */
export async function openProjectByDir(dirPath: string): Promise<void> {
    const root = resolveStorageRoot()
    const segments = toSafeSegments(toStorageRelativePath(dirPath, '作品'), '作品')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品路径非法：${dirPath}`)
    }
    const readme = buildStorageUri(root, [...segments, PROJECT_README_NAME])
    const document = await vscode.workspace.openTextDocument(readme)
    await vscode.window.showTextDocument(document, { preview: false })
    logger.info(`已打开作品：${dirPath}`)
}
