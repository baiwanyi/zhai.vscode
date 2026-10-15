/**
 * 笔记契约：宿主 note/create 与 note/pin 请求的出入参结构。
 * 使用方：Webview 仪表盘的「添加」与置顶入口、宿主侧笔记服务与仪表盘面板。
 * 约束：path 为相对存储根的路径，与索引库 files.path 同口径，前端据此定位列表条目；
 * 置顶请求的路径须经宿主按索引库校验存在性后才可写入，避免任意字符串污染宿主状态。
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
