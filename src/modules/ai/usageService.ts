/**
 * AI 用量查询：「AI 使用量」页的宿主侧实现，以 CodeBuddy 会话记录为明细主数据源，本地记账行只补模块与提示词归属。
 * 复用约定：一轮一行由 CliUsageIndex 汇总，模块键与范围枚举来自 shared/types/aiUsage，记录在此归一成下发契约；
 * 本地行按请求 id 关联，关联不上的标为 external；过期提示词在列表请求时顺带清理。
 * 关键约束：明细与汇总都按 CLI 记录的积分计，本地缺失时留空显示破折号，不做任何估算；
 * 积分消耗为 0 的轮次直接剔除，不占列表位置也不计入条数（未知积分保留，二者口径不同）；
 * 对账以 CLI 记录为准，已回填但偏小的值同样修正（工具调用积分可能晚落盘）；入参一律在本层收窄（模块白名单、
 * 范围枚举、页码夹紧、请求 id 长度与字符），不接受任意时间字符串；提示词只按请求 id 单条读取，
 * 本地未留存时回落到 CLI 会话记录（出图轮次取图像提示词，其余取用户消息原文）。
 */
import type {
    AiUsageItem,
    AiUsageListResult,
    AiUsageModule,
    AiUsagePeriods,
    AiUsagePromptResult,
    AiUsageQuery,
    AiUsageRange,
    AiUsageStatus,
    AiUsageSummary,
} from '@shared/types/aiUsage'
import { isAiUsageModule } from '@shared/types/aiUsage'
import {
    getPrompt,
    listAllUsageLogs,
    listUsageForCreditSync,
    prunePrompts,
    updateUsageCredits,
} from './db/usageRepository'
import type { CliUsageEntry, CliUsageIndex } from './cliUsageIndex'
import type { UsageLogRecord } from './db/usageRepository'
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
/** 积分比较容差：CLI 侧积分为逐条累加的浮点，与库内值比较时避免因尾差反复重写 */
const CREDIT_EPSILON = 1e-9
/** 参与关联的本地行上限：表随记账持续增长，只读最近若干条即可覆盖 CLI 记录的同期范围 */
const LOCAL_ROW_LIMIT = 2000

export class AiUsageService {
    public constructor(
        private readonly db: Database.Database,
        private readonly cliUsage: CliUsageIndex,
    ) {}

    /** 查询一页用量：以 CLI 记录为明细主数据源，先回填本地积分，再筛选、分页与汇总 */
    public list(query: AiUsageQuery): AiUsageListResult {
        this.pruneExpiredPrompts()
        this.syncCreditsFromCli(query.force === true)
        const pageSize = clamp(Math.trunc(query.pageSize) || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
        const page = clamp(Math.trunc(query.page) || 1, 1, MAX_PAGE)
        // 积分消耗为 0 的轮次不进列表（纯工具调用、未计费的重试等），避免把无消耗的行混进「积分消耗」视图；
        // credits 为 null 表示尚未对账，属于未知而非 0，仍保留并显示破折号
        const entries = this.collectEntries().filter((item) => item.credits !== 0)
        // 周期概览只跟随模块筛选，因此先按模块收窄，再按时间范围收窄列表与汇总
        const byModule = query.module === null ? entries : entries.filter((item) => item.module === query.module)
        const since = readSince(query.range)
        const filtered = since === null ? byModule : byModule.filter((item) => item.createdAt >= since)
        filtered.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
        const offset = (page - 1) * pageSize
        return {
            items: filtered.slice(offset, offset + pageSize),
            total: filtered.length,
            page,
            pageSize,
            summary: summarizeUsage(filtered),
            periods: readPeriods(byModule),
        }
    }

    /**
     * 汇总明细行：CLI 记录一轮一行，本地行按请求 id 提供模块、耗时与服务端成本。
     * 本地有请求 id 但 CLI 记录已清理的轮次仍然保留，积分留空显示破折号，避免记录凭空消失；
     * 本地没有请求 id 的行无法对账，其消耗已包含在对应的 CLI 条目里，不重复计入。
     */
    private collectEntries(): AiUsageItem[] {
        const byRequestId = new Map<string, UsageLogRecord>()
        for (const row of listAllUsageLogs(this.db, LOCAL_ROW_LIMIT)) {
            if (row.requestId !== null) {
                byRequestId.set(row.requestId, row)
            }
        }
        const items: AiUsageItem[] = []
        const matched = new Set<string>()
        for (const entry of this.cliUsage.listEntries()) {
            const row = byRequestId.get(entry.requestId)
            matched.add(entry.requestId)
            items.push(toCliItem(entry, row))
        }
        for (const [requestId, row] of byRequestId) {
            if (!matched.has(requestId)) {
                // CLI 记录已清理时用本地缓存值兜底，缓存的积分同样为空则显示破折号
                items.push(toItem(row))
            }
        }
        return items
    }

    /**
     * 用 CLI 会话记录回填缺失积分：普通查询走 5 秒节流，翻页与切筛选不会反复读盘；
     * force 为 true 时（表头刷新按钮）跳过节流立即重扫。
     */
    private syncCreditsFromCli(force: boolean): void {
        if (force) {
            this.cliUsage.refresh()
        } else {
            this.cliUsage.ensureFresh()
        }
        const pending = listUsageForCreditSync(this.db)
        if (pending.length === 0) {
            return
        }
        const updates = pending.flatMap((row) => {
            const credit = this.cliUsage.readCredit(row.requestId)
            if (credit === null) {
                return []
            }
            // 与库内一致则跳过，避免每次翻页都整批重写；积分为逐条累加，比较时留浮点容差
            if (row.credits !== null && Math.abs(row.credits - credit) < CREDIT_EPSILON) {
                return []
            }
            return [{ id: row.id, credits: credit }]
        })
        updateUsageCredits(this.db, updates)
    }

    /** 按请求 id 取提示词：优先本地留存，缺失时回落到 CLI 会话记录；都取不到时 found=false */
    public readPrompt(requestId: string): AiUsagePromptResult {
        if (!isValidRequestId(requestId)) {
            throw new Error('ai/usage/prompt 参数类型不正确')
        }
        const row = getPrompt(this.db, requestId)
        if (row !== undefined) {
            return { requestId, content: row.content, isTruncated: row.isTruncated, found: true }
        }
        // 记账功能上线前或未接记账的轮次，正文只存在于 CLI 记录里
        const fallback = this.cliUsage.readPrompt(requestId)
        if (fallback !== null) {
            return { requestId, content: fallback.content, isTruncated: fallback.isTruncated, found: true }
        }
        return { requestId, content: '', isTruncated: false, found: false }
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
    const starts = readPeriodStarts()
    if (range === 'today') {
        return starts.today.toISOString()
    }
    const days = range === '7d' ? 7 : 30
    return new Date(starts.today.getTime() - (days - 1) * DAY_MS).toISOString()
}

/** 周期概览：今日与本月累计只按模块筛选，不受列表时间范围影响 */
function readPeriods(items: AiUsageItem[]): AiUsagePeriods {
    const starts = readPeriodStarts()
    return {
        today: sumCredits(items.filter((item) => item.createdAt >= starts.today.toISOString())),
        month: sumCredits(items.filter((item) => item.createdAt >= starts.month.toISOString())),
    }
}

/** 周期起点：今日 0 点与本月 1 日 0 点，均按本地时间计算 */
function readPeriodStarts(): { today: Date; month: Date } {
    const now = new Date()
    return {
        today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        month: new Date(now.getFullYear(), now.getMonth(), 1),
    }
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

/** 模块判定：本地行优先；本地没有行时按该轮是否出图归类，其余视为未归属 */
function readEntryModule(entry: CliUsageEntry, row: UsageLogRecord | undefined): AiUsageModule {
    if (row !== undefined) {
        return toModule(row.module)
    }
    return entry.isImageGeneration ? 'image' : 'external'
}

/** CLI 条目转下发契约：匹配到本地行时取模块与耗时，未匹配按出图标记归类 */
function toCliItem(entry: CliUsageEntry, row: UsageLogRecord | undefined): AiUsageItem {
    return {
        id: entry.requestId,
        requestId: entry.requestId,
        createdAt: entry.createdAt,
        module: readEntryModule(entry, row),
        model: entry.model.length > 0 ? entry.model : (row?.model ?? ''),
        credits: entry.credit,
        costUsd: row?.costUsd ?? 0,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        durationMs: row?.latencyMs ?? 0,
        status: row === undefined ? 'completed' : toStatus(row.status),
    }
}

/** 汇总：requests 计全部行，credits 只累加已知值，全未知时返回 null */
function summarizeUsage(items: AiUsageItem[]): AiUsageSummary {
    return {
        requests: items.length,
        credits: sumCredits(items),
        costUsd: items.reduce((total, item) => total + item.costUsd, 0),
        tokens: items.reduce((total, item) => total + item.totalTokens, 0),
    }
}

/** 积分合计：没有任何已知积分时返回 null，避免把未知显示成 0 */
function sumCredits(items: AiUsageItem[]): number | null {
    const known = items.filter((item) => item.credits !== null)
    if (known.length === 0) {
        return null
    }
    return known.reduce((total, item) => total + (item.credits ?? 0), 0)
}

/**
 * 模块归一：合法模块键原样保留，旧库的 ai-chat 等取值统一视为对话。
 * 关键约束：判定直接复用共享类型守卫，不再另写白名单——否则新增模块（如 proofread）会被静默归到对话。
 */
function toModule(value: string): AiUsageModule {
    return isAiUsageModule(value) ? value : 'chat'
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
