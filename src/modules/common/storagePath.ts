/**
 * 存储路径工具：以文档存储根为基准构造绝对 Uri，校验索引库口径的相对路径片段，并提供统一的删除入口。
 * 复用 common/config 的存储根解析；笔记、作品等模块共用同一套拼装、越界校验与删除策略，避免各处各写一份。
 * 关键约束：路径先经片段校验（拒绝上跳、当前目录、盘符与反斜杠）再交给 path.join，从源头排除越出存储根；
 * 错误文案带入调用方给定的实体名（如「笔记」「作品」），便于用户定位到具体入口；
 * 删除一律走 deleteResource，回收站不可用时由它显式降级，不依赖调用方各自处理。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from './config'
import { logger } from './logger'

/**
 * 以存储根为基准构造目标 Uri：先确认存储根可解析为本地绝对路径，再交给 path.join + Uri.file 构造。
 * 关键约束：workspace.fs 只接受带前导斜杠的绝对路径，而 Uri.file 仅在路径为盘符反斜杠写法时才补前导
 * 斜杠；path.join 在 Windows 下产出反斜杠形式，恰好满足该前提，故不依赖 Uri.joinPath 的平台分支判断。
 */
export function buildStorageUri(root: vscode.Uri, segments: string[]): vscode.Uri {
    const basePath = root.fsPath
    if (!path.isAbsolute(basePath)) {
        throw new Error(`文档保存目录不是绝对本地路径：${basePath}（scheme=${root.scheme} path=${root.path}）`)
    }
    return vscode.Uri.file(path.join(basePath, ...segments))
}

/**
 * 切分并校验索引库口径的相对路径：忽略空段，含上跳、当前目录、盘符或反斜杠的输入一律拒绝。
 * 安全约束：path.join 会规范化上跳片段，未校验时 `notes/../..` 之类的输入可越出存储根。
 */
export function toSafeSegments(relativePath: string, label: string): string[] {
    const segments = relativePath.split('/').filter((segment) => segment.length > 0)
    const isUnsafeSegment = (segment: string): boolean =>
        segment === '.' || segment === '..' || segment.includes('\\') || segment.includes(':')
    if (segments.length === 0 || segments.some(isUnsafeSegment)) {
        throw new Error(`${label}路径非法：${relativePath}`)
    }
    return segments
}

/** 路径比较用的规范化：去掉前导与尾部斜杠并统一小写（Windows 上盘符大小写不影响路径同一性） */
function normalizeForCompare(value: string): string {
    return value.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * 归一化为存储根口径的相对路径：索引库的历史记录可能存有绝对形式（Uri.path，如 /c:/root/notes/a.md），
 * 此时按存储根前缀剥离为相对路径；不属于存储根的绝对路径直接拒绝。
 * 关键约束：比较统一小写并忽略前导斜杠差异，避免 Uri.path 与 fsPath 的形态差异导致误判；
 * 归一化只做前缀剥离，越出存储根的进一步尝试仍由 toSafeSegments 拦截。
 */
export function toStorageRelativePath(indexPath: string, label: string): string {
    if (!indexPath.startsWith('/')) {
        return indexPath
    }
    const rootPath = resolveStorageRoot().path
    if (!normalizeForCompare(indexPath).startsWith(`${normalizeForCompare(rootPath)}/`)) {
        throw new Error(`${label}路径不在存储根内：${indexPath}`)
    }
    const rawRoot = rootPath.replace(/^\/+/, '').replace(/\/+$/, '')
    return indexPath.replace(/^\/+/, '').slice(rawRoot.length + 1)
}

/** 判定目标是否已存在：stat 抛错即视为不存在（FileSystem 未提供 exists API），文件与目录同口径 */
export async function isPathExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

/** 删除方式：trash 表示已移入系统回收站（可恢复），permanent 表示回收站不可用时的永久删除（不可恢复） */
export type DeleteOutcome = 'trash' | 'permanent'

/** 把异常收敛成单行文案：删除失败的两条原因都要能进日志与提示，故不接受无信息的兜底串 */
function toCauseMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 删除文件或目录：优先移入系统回收站，回收站不可用时退化为永久删除。
 * 关键约束：workspace.fs.delete 在 useTrash 失败时不会自动降级（Windows 回收站被禁用、容量不足、
 * 目标被占用、非 NTFS 卷不支持回收站都会以「未能将…移动到回收站」整单失败），必须显式重试；
 * 两次都失败时抛出同时携带两条原因的错误，调用方据此提示用户，避免只看到一句泛化失败。
 */
export async function deleteResource(uri: vscode.Uri, recursive: boolean): Promise<DeleteOutcome> {
    try {
        await vscode.workspace.fs.delete(uri, { recursive, useTrash: true })
        return 'trash'
    } catch (trashCause) {
        const trashMessage = toCauseMessage(trashCause)
        logger.warn(`移入回收站失败，改为永久删除：${uri.fsPath}（${trashMessage}）`)
        try {
            await vscode.workspace.fs.delete(uri, { recursive, useTrash: false })
            return 'permanent'
        } catch (permanentCause) {
            throw new Error(
                `删除失败：${uri.fsPath}（回收站：${trashMessage}；直接删除：${toCauseMessage(permanentCause)}）`,
                { cause: permanentCause },
            )
        }
    }
}
