/**
 * 仪表盘数据契约：宿主 dashboard/stats 请求的返回结构。
 * 使用方：Webview 仪表盘（src/webview/dashboard.tsx）与宿主侧 DashboardViewProvider。
 * 约束：字段由宿主聚合后填充，前端只负责展示，不承担解析与拼装。
 */

/** 单个模块（存储根下的一级目录）的统计 */
export interface ModuleStat {
    /** 模块名，无一级目录的顶层文件归入「根目录」 */
    name: string
    fileCount: number
    wordCount: number
}

/** 最近更新的文件条目 */
export interface RecentFile {
    path: string
    title: string
    wordCount: number
    /** ISO 8601 时间戳 */
    mtime: string
}

/** 仪表盘统计快照 */
export interface DashboardStats {
    /** 已索引文件数 */
    indexedCount: number
    /** 全库字数合计 */
    totalWords: number
    /** 去重后的标签数 */
    tagCount: number
    /** 各模块分布，按文件数倒序 */
    moduleStats: ModuleStat[]
    /** 最近更新的文件，按 mtime 倒序 */
    recentFiles: RecentFile[]
    /** 上次全量构建时间，从未构建为 null */
    lastBuiltAt: string | null
    /** 是否正在重建索引 */
    isRebuilding: boolean
}
