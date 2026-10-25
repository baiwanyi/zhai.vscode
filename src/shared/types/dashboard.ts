/**
 * 仪表盘数据契约：宿主 dashboard/stats 请求的返回结构。
 * 使用方：Webview 仪表盘（src/dashboard/dashboard.tsx）与宿主侧 DashboardViewProvider。
 * 约束：字段由宿主聚合后填充，前端只负责展示，不承担解析与拼装；
 * 置顶状态来自宿主偏好，列表顺序已由宿主排定（置顶项在前）。
 */

/** 单个模块（存储根下的一级目录）的统计 */
export interface ModuleStat {
    /** 模块名，无一级目录的顶层文件归入「根目录」 */
    name: string
    fileCount: number
    wordCount: number
}

/** 列表中的文件条目 */
export interface RecentFile {
    path: string
    title: string
    wordCount: number
    /** ISO 8601 时间戳 */
    mtime: string
    /** 是否被宿主置顶，置顶项在列表中被排至最前 */
    isPinned: boolean
}

/** 仪表盘统计快照 */
export interface DashboardStats {
    /** 已索引文件数 */
    indexedCount: number
    /** 全库字数合计 */
    totalWords: number
    /** 去重后的标签数 */
    tagCount: number
    /** 笔记目录（notes/）下的模块分布，按文件数倒序；press 等其它模块不计入 */
    moduleStats: ModuleStat[]
    /** 最近更新的笔记（只含 notes/ 目录），按 mtime 倒序且置顶项置前 */
    recentFiles: RecentFile[]
    /** 上次全量构建时间，从未构建为 null */
    lastBuiltAt: string | null
    /** 是否正在重建索引 */
    isRebuilding: boolean
}

/** 笔记条目可发起的操作：open 与 delete 的宿主协议尚未接入，pin 与 unpin 已由 note/pin 承接 */
export type NoteAction = 'open' | 'delete' | 'pin' | 'unpin'
