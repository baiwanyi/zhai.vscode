/**
 * AI 用量契约：宿主 ai/usage 协议的筛选、列表与提示词查询结构，以及模块标识与展示文案的共用映射。
 * 复用约定：字段由宿主归一化后填充（积分取自 CodeBuddy 会话记录，未对账一律为 null），前端只负责展示与格式化；
 * 模块键是宿主记账与前端筛选的唯一口径，标签表放在此处避免两侧各写一份导致筛选项与数据对不上。
 * 关键约束：提示词只经 ai/usage/prompt 按请求 id 单独拉取，列表结果不携带正文；
 * 时间范围以枚举下发，由宿主换算成起止时间，前端不得传任意时间字符串。
 */

/** 用量来源模块：对话 / 取名 / 外貌 / 语义归纳 / 画面描述 */
export type AiUsageModule = 'chat' | 'naming' | 'appearance' | 'semantic' | 'scene'

/** 时间筛选：今日、近 7 天、近 30 天、全部 */
export type AiUsageRange = 'today' | '7d' | '30d' | 'all'

/** 记录状态：仅成功与取消两类会写库，failed 预留给失败请求 */
export type AiUsageStatus = 'completed' | 'cancelled' | 'failed'

/** 模块展示名：宿主写库与前端筛选共用 */
export const AI_USAGE_MODULE_LABELS: Readonly<Record<AiUsageModule, string>> = {
    chat: 'AI对话',
    naming: '取名',
    appearance: '外貌生成',
    semantic: '语义归纳',
    scene: '画面描述',
}

/** 时间范围展示名 */
export const AI_USAGE_RANGE_LABELS: Readonly<Record<AiUsageRange, string>> = {
    today: '今天',
    '7d': '近 7 天',
    '30d': '近 30 天',
    all: '全部',
}

/** 判断是否为合法模块键：协议入参来自 Webview，须逐值收窄 */
export function isAiUsageModule(value: unknown): value is AiUsageModule {
    return value === 'chat' || value === 'naming' || value === 'appearance' || value === 'semantic' || value === 'scene'
}

/** 判断是否为合法时间范围 */
export function isAiUsageRange(value: unknown): value is AiUsageRange {
    return value === 'today' || value === '7d' || value === '30d' || value === 'all'
}

/** 单条用量记录：已按展示需要归一，不含提示词正文 */
export interface AiUsageItem {
    /** 日志主键，供前端做列表 key */
    id: string
    /** 请求标识：通道侧轮次标识，缺失时宿主回落到日志主键 */
    requestId: string
    /** 记录时间（ISO） */
    createdAt: string
    module: AiUsageModule
    /** 模型 id；空串表示交给 CLI 的默认模型 */
    model: string
    /** 真实积分（CodeBuddy 会话记录中的消息积分与工具积分之和）；尚未对账时为 null */
    credits: number | null
    /** 服务端计价（美元），0 为有效值 */
    costUsd: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /** 生成耗时（毫秒） */
    durationMs: number
    status: AiUsageStatus
}

/** 汇总：与当前筛选条件一致的总量，供表头展示 */
export interface AiUsageSummary {
    requests: number
    /** 积分合计；范围内没有任何已对账记录时为 null */
    credits: number | null
    costUsd: number
    tokens: number
}

/** 列表查询：模块为 null 表示不筛选 */
export interface AiUsageQuery {
    module: AiUsageModule | null
    range: AiUsageRange
    page: number
    pageSize: number
    /** 为 true 时跳过索引节流，立即重扫 CodeBuddy 会话记录（表头刷新按钮使用） */
    force?: boolean
}

/** 列表结果：分页在宿主侧完成，total 为满足筛选条件的总条数 */
export interface AiUsageListResult {
    items: AiUsageItem[]
    total: number
    page: number
    pageSize: number
    summary: AiUsageSummary
}

/** 提示词查询结果：found 为 false 表示该请求未记录或已过期清理 */
export interface AiUsagePromptResult {
    requestId: string
    content: string
    isTruncated: boolean
    found: boolean
}
