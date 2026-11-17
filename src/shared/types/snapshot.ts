/**
 * 单文件快照协议：笔记、公众号文章与散落 md 的正文时间线契约。
 * 使用方：Webview 工作流页的单文件快照面板与宿主侧 PressSnapshotService / pressRoutes。
 * 复用约定：标识格式复用 @shared/types/press 的 isPressSnapshotId，请求经 bridge 的 request 发出，
 * 方法名登记在 shared/types/messages 的白名单内。
 * 关键约束：docPath 必须是存储根相对路径且以 .md 结尾（绝对路径、盘符与上跳片段在守卫层就拒绝），
 * 该值由宿主下发、前端原样回传，前端不得自行拼装路径；恢复与删除只认固定格式的快照标识。
 */
import { isPressSnapshotId } from './press'

/** 快照来源：auto 为保存后自动留版，ai-write 为写回前留底，manual 为用户手动，restore 为恢复前留底，push 为公众号推送留底 */
export type DocSnapshotReason = 'auto' | 'ai-write' | 'manual' | 'restore' | 'push'

/** 单文件某一版：只含元信息，正文按需读取 */
export interface DocSnapshotEntry {
    id: string
    /** 文档相对存储根的路径，记录留版当时的取值，便于改名后排查 */
    docPath: string
    title: string
    createdAt: string
    reason: DocSnapshotReason
    /** 手动留版与推送留底的备注，自动留版为空串 */
    label: string
    sizeBytes: number
}

/** press/snapshot/doc/list 请求 */
export interface DocSnapshotListRequest {
    docPath: string
}

/** press/snapshot/doc/list 响应：按创建时间倒序 */
export interface DocSnapshotListResult {
    versions: DocSnapshotEntry[]
}

/** press/snapshot/doc/capture 请求：手动留一版，label 为备注 */
export interface DocSnapshotCaptureRequest {
    docPath: string
    label?: string
}

/** press/snapshot/doc/capture 响应 */
export interface DocSnapshotCaptureResult {
    snapshot: DocSnapshotEntry
}

/** press/snapshot/doc/restore 请求 */
export interface DocSnapshotRestoreRequest {
    docPath: string
    snapshotId: string
}

/** press/snapshot/doc/restore 响应：false 表示内容与所选版本一致，未写盘 */
export interface DocSnapshotRestoreResult {
    restored: boolean
}

/** press/snapshot/doc/delete 请求 */
export interface DocSnapshotDeleteRequest {
    docPath: string
    snapshotId: string
}

/** press/snapshot/doc/delete 响应 */
export interface DocSnapshotDeleteResult {
    deleted: boolean
}

/**
 * 判断文档路径是否具备基本形态：相对路径、Markdown 结尾、不含上跳与盘符。
 * 关键约束：本函数只做格式初筛；是否真在存储根内、目录是否可写由宿主按存储根重新拼装时校验。
 */
export function isDocSnapshotPath(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
        return false
    }
    if (value.includes('..') || value.includes(':')) {
        return false
    }
    if (value.startsWith('/') || value.startsWith('\\')) {
        return false
    }
    return value.toLowerCase().endsWith('.md')
}

/** 判断是否为合法的时间线列举请求（类型收窄辅助） */
export function isDocSnapshotListRequest(payload: unknown): payload is DocSnapshotListRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isDocSnapshotPath((payload as { docPath?: unknown }).docPath)
}

/** 判断是否为合法的手动留版请求（类型收窄辅助）：备注可选，超长备注由宿主截断 */
export function isDocSnapshotCaptureRequest(payload: unknown): payload is DocSnapshotCaptureRequest {
    if (!isDocSnapshotListRequest(payload)) {
        return false
    }
    const label = (payload as { label?: unknown }).label
    return label === undefined || typeof label === 'string'
}

/** 判断是否为合法的恢复请求（类型收窄辅助） */
export function isDocSnapshotRestoreRequest(payload: unknown): payload is DocSnapshotRestoreRequest {
    if (!isDocSnapshotListRequest(payload)) {
        return false
    }
    return isPressSnapshotId((payload as { snapshotId?: unknown }).snapshotId)
}

/** 判断是否为合法的删除请求（类型收窄辅助）：与恢复同形 */
export function isDocSnapshotDeleteRequest(payload: unknown): payload is DocSnapshotDeleteRequest {
    return isDocSnapshotRestoreRequest(payload)
}
