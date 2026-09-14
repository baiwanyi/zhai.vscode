/**
 * 搜索与索引数据契约：宿主 search/query 与 index/status 两类请求的返回结构。
 * 使用方：宿主侧索引仓储（FTS 检索）与后续搜索面板；仪表盘统计契约见 dashboard.ts。
 * 约束：字段由宿主归一化后填充，前端只负责展示，不承担解析与拼装。
 */
export interface SearchHit {
    path: string
    title: string
    tags: string[]
    snippet: string
}

export interface IndexStatus {
    indexedCount: number
    lastBuiltAt: string | null
    isRebuilding: boolean
}
