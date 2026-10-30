/**
 * 笔记契约：宿主 note/create、note/pin、note/open 请求的出入参结构，以及活跃笔记快照。
 * 使用方：Webview 仪表盘的「添加」「置顶」「打开」入口与列表选中态，宿主侧笔记服务与仪表盘面板。
 * 约束：path 为相对存储根的路径，与索引库 files.path 同口径；
 * 置顶与打开的请求路径均须由宿主按索引库校验存在性后才可继续处理，避免任意字符串触及文件系统；
 * 活跃笔记快照由宿主权威下发，前端不自造选中态。
 */

/** 新建空笔记的结果 */
export interface CreatedNote {
    /** 相对存储根的文件路径，形如 notes/202610/{uuid}.md */
    path: string
    /** 笔记标题，与写入的 Frontmatter title 一致 */
    title: string
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
