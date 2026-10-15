/**
 * 笔记契约：宿主 note/create、note/pin 与 note/open 请求的出入参结构。
 * 使用方：Webview 仪表盘的「添加」「置顶」「打开」入口，宿主侧笔记服务与仪表盘面板。
 * 约束：path 为相对存储根的路径，与索引库 files.path 同口径；
 * 置顶与打开的请求路径均须由宿主按索引库校验存在性后才可继续处理，避免任意字符串触及文件系统。
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
