/**
 * 笔记本契约：笔记本列表、偏好与增删改请求的出入参结构。
 * 使用方：Webview 仪表盘的笔记本分组列表与宿主侧笔记本服务。
 * 约束：id 为相对存储根的目录路径（notes/<目录>），「未分类」固定为 notes/未分类；
 * 所有写请求的 id 须由宿主按目录形态白名单校验后才可触及文件系统；
 * 排序与展开属于视图偏好，由宿主持久化，前端不自造顺序。
 */
import type { RecentFile } from './dashboard'

/** 笔记本排序方式：按名称升序或按修改时间降序（默认） */
export type NotebookSort = 'name' | 'mtime'

/** 笔记本条目：磁盘目录与索引库统计的合并结果 */
export interface NotebookSummary {
    /** 笔记本 id，形如 notes/AMZ；未分类固定为 notes/未分类 */
    id: string
    /** 展示名，即目录名 */
    name: string
    noteCount: number
    wordCount: number
    /** 目录内最新笔记的 mtime；空笔记本取目录 stat.mtime */
    mtime: string
    /** 是否被置顶，置顶项在列表中成组排在最前 */
    isPinned: boolean
    /** 是否为新建笔记的默认落点 */
    isDefault: boolean
    /** 是否为按月自动归档的目录（notes/YYYYMM），仅影响展示名，不限制重命名与删除 */
    isAuto: boolean
    /** 是否为未分类（含笔记根下的散落文档） */
    isUnclassified: boolean
}

/** 笔记本视图偏好：由宿主持久化，前端只读并上抛变更 */
export interface NotebookPrefs {
    sort: NotebookSort
    /** 已展开（已打开）的笔记本 id 集合，顺序无关 */
    openIds: string[]
    /** 新建笔记的默认落点，null 表示尚未确定 */
    defaultId: string | null
}

/** notebook/create 请求 */
export interface CreateNotebookRequest {
    name: string
}

/** notebook/create 响应 */
export interface CreateNotebookResult {
    notebook: NotebookSummary
}

/** notebook/rename 请求 */
export interface RenameNotebookRequest {
    id: string
    name: string
}

/** notebook/rename 响应 */
export interface RenameNotebookResult {
    id: string
    name: string
}

/** notebook/delete 请求：删除后笔记本内的笔记一律移入回收站 */
export interface DeleteNotebookRequest {
    id: string
}

/** 单条失败原因 */
export interface NotebookFailure {
    value: string
    message: string
}

/** notebook/delete 响应 */
export interface DeleteNotebookResult {
    deleted: boolean
    /** 随之移入回收站的笔记条数 */
    trashedNotes: number
    failures: NotebookFailure[]
}

/** notebook/pin 请求：批量设置置顶 */
export interface PinNotebooksRequest {
    ids: string[]
    isPinned: boolean
}

/** notebook/pin 响应 */
export interface PinNotebooksResult {
    pinnedIds: string[]
}

/** notebook/setSort 请求 */
export interface SetNotebookSortRequest {
    sort: NotebookSort
}

/** notebook/setSort 响应 */
export interface SetNotebookSortResult {
    sort: NotebookSort
}

/** notebook/setOpen 请求：整表覆盖已展开集合 */
export interface SetNotebookOpenRequest {
    ids: string[]
}

/** notebook/setOpen 响应 */
export interface SetNotebookOpenResult {
    openIds: string[]
}

/** notebook/notes 请求：展开某个笔记本时按需读取其笔记 */
export interface ListNotebookNotesRequest {
    id: string
    /** 读取条数上限，省略时由宿主取默认值 */
    limit?: number
}

/** notebook/notes 响应 */
export interface ListNotebookNotesResult {
    items: RecentFile[]
}

/** 笔记本 id 的形态：notes/<单段目录>，未分类同样落在该形态内 */
const NOTEBOOK_ID_PATTERN = /^notes\/[^/\\:]+$/

/** 判断是否为合法笔记本 id（类型收窄辅助） */
export function isNotebookId(value: unknown): value is string {
    return typeof value === 'string' && NOTEBOOK_ID_PATTERN.test(value)
}

/** 判断是否为合法排序方式（类型收窄辅助） */
export function isNotebookSort(value: unknown): value is NotebookSort {
    return value === 'name' || value === 'mtime'
}

/** 判断是否为合法的新建请求 */
export function isCreateNotebookRequest(payload: unknown): payload is CreateNotebookRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { name?: unknown }
    return typeof candidate.name === 'string' && candidate.name.trim().length > 0
}

/** 判断是否为合法的重命名请求 */
export function isRenameNotebookRequest(payload: unknown): payload is RenameNotebookRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; name?: unknown }
    return isNotebookId(candidate.id) && typeof candidate.name === 'string' && candidate.name.trim().length > 0
}

/** 判断是否为合法的删除请求 */
export function isDeleteNotebookRequest(payload: unknown): payload is DeleteNotebookRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isNotebookId((payload as { id?: unknown }).id)
}

/** 判断是否为合法的置顶请求 */
export function isPinNotebooksRequest(payload: unknown): payload is PinNotebooksRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { ids?: unknown; isPinned?: unknown }
    if (typeof candidate.isPinned !== 'boolean' || !Array.isArray(candidate.ids)) {
        return false
    }
    return candidate.ids.every((item: unknown) => isNotebookId(item))
}

/** 判断是否为合法的排序偏好请求 */
export function isSetNotebookSortRequest(payload: unknown): payload is SetNotebookSortRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isNotebookSort((payload as { sort?: unknown }).sort)
}

/** 判断是否为合法的展开集合请求 */
export function isSetNotebookOpenRequest(payload: unknown): payload is SetNotebookOpenRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { ids?: unknown }
    return Array.isArray(candidate.ids) && candidate.ids.every((item: unknown) => isNotebookId(item))
}

/** 判断是否为合法的笔记读取请求 */
export function isListNotebookNotesRequest(payload: unknown): payload is ListNotebookNotesRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; limit?: unknown }
    if (!isNotebookId(candidate.id)) {
        return false
    }
    return candidate.limit === undefined || (typeof candidate.limit === 'number' && candidate.limit > 0)
}
