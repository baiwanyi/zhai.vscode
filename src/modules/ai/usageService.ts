/**
 * AI 用量查询：「AI 使用量」页的宿主侧实现，负责时间范围换算、分页夹紧、汇总与提示词按需读取。
 * 复用约定：分页、计数与汇总复用 usageRepository 的同一 WHERE 口径；模块键与范围枚举来自 shared/types/aiUsage，
 * 记录行在此归一成下发契约，前端不再二次解析；过期提示词在列表请求时顺带清理。
 * 关键约束：入参一律在本层收窄（模块白名单、范围枚举、页码夹紧、请求 id 长度与字符），不接受任意时间字符串；
 * 提示词只按请求 id 单条读取，缺失时返回 found=false 而不是抛错。
 */
import { countUsageLogs, getPrompt, listUsageLogs, prunePrompts, sumUsageLogs } from './db/usageRepository'
import type { UsageLogRecord } from './db/usageRepository'
import type {
    AiUsageItem,
    AiUsageListResult,
    AiUsageModule,
    AiUsagePromptResult,
    AiUsageQuery,
    AiUsageRange,
    AiUsageStatus,
} from '../../shared/types/aiUsage'
import type Database from 'better-sqlite3'

/** 默认与最大页大小：列表行数有限，超出上限直接夹紧而不是报错 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
/** 页码上限：防止异常载荷把偏移量算成天文数字 */
const MAX_PAGE = 500
/** 提示词保留天数：超期记录在下次打开列表时清理 */
const PROMPT_RETENTION_DAYS = 30
/** 请求 id 长度上限：SDK 标识远短于此值，超出视为异常载荷 */
const MAX_REQUEST_ID_LENGTH = 64
/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000

export class AiUsageService {
    public constructor(private readonly db: Database.Database) {}

    /** 查询一页用量：筛选与分页都在库侧完成 */
    public list(query: AiUsageQuery): AiUsageListResult {
        this.pruneExpiredPrompts()
        const pageSize = clamp(Math.trunc(query.pageSize) || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
        const page = clamp(Math.trunc(query.page) || 1, 1, MAX_PAGE)
        const filter = { module: query.module, since: readSince(query.range) }
        const total = countUsageLogs(this.db, filter)
        const summaryRow = sumUsageLogs(this.db, filter)
        const rows = listUsageLogs(this.db, { ...filter, limit: pageSize, offset: (page - 1) * pageSize })
        return {
            items: rows.map(toItem),
            total,
            page,
            pageSize,
            summary: {
                requests: summaryRow.requests,
                credits: summaryRow.credits,
                costUsd: summaryRow.costUsd,
                tokens: summaryRow.tokens,
            },
        }
    }

    /** 按请求 id 取提示词：历史记录可能未留存，缺失时 found=false */
    public readPrompt(requestId: string): AiUsagePromptResult {
        if (!isValidRequestId(requestId)) {
            throw new Error('ai/usage/prompt 参数类型不正确')
        }
        const row = getPrompt(this.db, requestId)
        if (row === undefined) {
            return { requestId, content: '', isTruncated: false, found: false }
        }
        return { requestId, content: row.content, isTruncated: row.isTruncated, found: true }
    }

    /** 清理保留期外的提示词：只在列表请求时触发，避免常驻定时器 */
    public pruneExpiredPrompts(): void {
        prunePrompts(this.db, new Date(Date.now() - PROMPT_RETENTION_DAYS * DAY_MS).toISOString())
    }
}

/** 时间范围换算：按本地 0 点对齐，「近 N 天」含今天 */
function readSince(range: AiUsageRange): string | null {
    if (range === 'all') {
        return null
    }
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (range === 'today') {
        return startOfToday.toISOString()
    }
    const days = range === '7d' ? 7 : 30
    return new Date(startOfToday.getTime() - (days - 1) * DAY_MS).toISOString()
}

/** 行转下发契约：模块与状态按白名单收窄，历史行统一归到对话模块 */
function toItem(row: UsageLogRecord): AiUsageItem {
    return {
        id: row.id,
        requestId: row.requestId ?? row.id,
        createdAt: row.createdAt,
        module: toModule(row.module),
        model: row.model,
        credits: row.credits,
        costUsd: row.costUsd,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        durationMs: row.latencyMs,
        status: toStatus(row.status),
    }
}

/** 模块归一：旧库的 ai-chat 等取值统一视为对话 */
function toModule(value: string): AiUsageModule {
    switch (value) {
        case 'naming':
        case 'appearance':
        case 'semantic':
        case 'scene':
            return value
        default:
            return 'chat'
    }
}

function toStatus(value: string): AiUsageStatus {
    if (value === 'cancelled' || value === 'failed') {
        return value
    }
    return 'completed'
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/** 请求 id 校验：只接受 UUID / 通道标识常见的字母数字与连字符 */
function isValidRequestId(value: string): boolean {
    return value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
}
