/**
 * 笔记契约：宿主 note/create、note/pin、note/open、note/delete 请求的出入参结构，以及活跃笔记快照。
 * 使用方：Webview 仪表盘的「添加」「置顶」「打开」「删除」入口与列表选中态，宿主侧笔记服务与仪表盘面板。
 * 约束：path 为相对存储根的路径，与索引库 files.path 同口径；
 * 置顶、打开与删除的请求路径均须由宿主按索引库校验存在性后才可继续处理，避免任意字符串触及文件系统；
 * 删除为批量语义且只移入应用内回收站：单条删除即长度为 1 的路径集合，全部失败也不抛错而由 failures 回传原因；
 * 新建可指定落点笔记本，未指定时宿主落到「未分类」，但笔记本 id 同样须经宿主白名单校验；
 * 活跃笔记快照由宿主权威下发，前端不自造选中态。
 */
import { isNotebookId } from './notebook'
import type { RecentFile } from './dashboard'

/** 新建空笔记的结果 */
export interface CreatedNote {
    /** 相对存储根的文件路径，形如 notes/202610/{uuid}.md */
    path: string
    /** 笔记标题，与写入的 Frontmatter title 一致 */
    title: string
}

/** note/create 请求：可指定落点笔记本，省略时落未分类 */
export interface CreateNoteRequest {
    /** 目标笔记本 id，形如 notes/AMZ；省略时由宿主取默认笔记本 */
    notebookId?: string
}

/** note/pin 请求：批量设置置顶状态 */
export interface PinNotesRequest {
    /** 待设置的笔记路径集合 */
    paths: string[]
    /** true 为置顶，false 为取消置顶 */
    isPinned: boolean
}

/** note/pin 响应：更新后的置顶路径列表，其顺序即列表展示顺序 */
export interface PinNotesResult {
    pinnedPaths: string[]
}

/** note/open 请求：打开指定笔记 */
export interface OpenNoteRequest {
    /** 待打开的笔记路径 */
    path: string
}

/** note/open 响应：确认已交由编辑器展示 */
export interface OpenNoteResult {
    opened: boolean
}

/** note/delete 请求：批量删除笔记（单条删除即长度为 1 的集合，删除即移入回收站） */
export interface DeleteNotesRequest {
    /** 待删除的笔记路径集合 */
    paths: string[]
}

/** 单条笔记删除失败的原因 */
export interface NoteDeleteFailure {
    path: string
    /** 失败原因，可直接展示给用户 */
    message: string
}

/** note/delete 响应：已移入回收站的路径与失败明细 */
export interface DeleteNotesResult {
    /** 已移入回收站并清理索引的笔记路径（原路径） */
    trashedPaths: string[]
    /** 未处理的路径与原因，全部成功时为空数组 */
    failures: NoteDeleteFailure[]
}

/** note/search 请求：跨笔记本搜索笔记 */
export interface SearchNotesRequest {
    /** 关键词，匹配标题与路径 */
    query: string
    /** 命中条数上限，省略时由宿主取默认值 */
    limit?: number
}

/** note/search 响应 */
export interface SearchNotesResult {
    items: RecentFile[]
}

/** 判断是否为合法的搜索请求 */
export function isSearchNotesRequest(payload: unknown): payload is SearchNotesRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { query?: unknown; limit?: unknown }
    if (typeof candidate.query !== 'string' || candidate.query.trim().length === 0) {
        return false
    }
    return candidate.limit === undefined || (typeof candidate.limit === 'number' && candidate.limit > 0)
}

/** 判断是否为合法的创建请求：未带笔记本时放行，带了则必须是合法笔记本 id */
export function isCreateNoteRequest(payload: unknown): payload is CreateNoteRequest {
    if (payload === undefined) {
        return true
    }
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { notebookId?: unknown }
    return candidate.notebookId === undefined || isNotebookId(candidate.notebookId)
}

/** 判断是否为合法的删除请求（类型收窄辅助） */
export function isDeleteNotesRequest(payload: unknown): payload is DeleteNotesRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { paths?: unknown }
    if (!Array.isArray(candidate.paths) || candidate.paths.length === 0) {
        return false
    }
    return candidate.paths.every((item: unknown) => typeof item === 'string' && item.length > 0)
}

/** 判断是否为合法的置顶请求（类型收窄辅助） */
export function isPinNotesRequest(payload: unknown): payload is PinNotesRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { paths?: unknown; isPinned?: unknown }
    if (typeof candidate.isPinned !== 'boolean' || !Array.isArray(candidate.paths)) {
        return false
    }
    return candidate.paths.every((item: unknown) => typeof item === 'string')
}

/** 判断是否为合法的打开请求（类型收窄辅助） */
export function isOpenNoteRequest(payload: unknown): payload is OpenNoteRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { path?: unknown }
    return typeof candidate.path === 'string' && candidate.path.length > 0
}

/**
 * 活跃笔记快照：宿主随编辑器焦点变化广播，也可按需请求，供列表回填选中态。
 * 约束：activePath 为相对存储根的路径且须在索引库内，焦点不在笔记上（或落在索引外）时为 null。
 * hasEditor 用于区分「焦点不在文本编辑器」与「编辑器里是索引外文档（未保存的 untitled 等）」——
 * 两者 activePath 都是 null，但前者不该改变面板当前页，后者应判定为无归属。
 */
export interface NoteActiveState {
    activePath: string | null
    hasEditor: boolean
}

/** 判断是否为合法的活跃笔记快照（类型收窄辅助） */
export function isNoteActiveState(payload: unknown): payload is NoteActiveState {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { activePath?: unknown; hasEditor?: unknown }
    if (typeof candidate.hasEditor !== 'boolean') {
        return false
    }
    return candidate.activePath === null || typeof candidate.activePath === 'string'
}
