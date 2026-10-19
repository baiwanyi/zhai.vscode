/**
 * 取名服务：组装选项摘要、执行本地 / AI 生成、维护历史批次与收藏，供 naming/* 协议调用。
 * 复用约定：词素表来自 ./data，生成算法来自 ./generator，AI 通道经 ./ai 复用对话客户端；
 * 历史与收藏经 ./db 仓储落 naming.db，AI 每日次数记在 meta 表；生成前读取近期同分类结果作为排除集合。
 * 关键约束：入参一律经 normalizeNamingRequest 收窄；历史只存条件快照与结果数组，不存提示词与密钥；
 * AI 结果必须经 namingPrompt 校验，不合规时整体回退报错；批次总量按 HISTORY_LIMIT 裁剪。
 */
import { randomUUID } from 'node:crypto'
import { generateNamesWithAi } from './ai/aiNameGenerator'
import { parseNamingResponse } from './ai/namingPrompt'
import {
    ERA_OPTIONS,
    GENDER_OPTIONS,
    LENGTH_OPTIONS,
    NAME_COUNTS,
    NAMING_CATEGORIES,
    REFERENCE_OPTIONS,
    SURNAME_KIND_OPTIONS,
    readCategoryDefinition,
} from './data/catalog'
import { ENTITY_SUFFIXES } from './data/suffixes'
import { CN_COMPOUND_SURNAMES, CN_SINGLE_SURNAMES } from './data/surnames'
import {
    clearBatches,
    deleteFavorite,
    insertBatch,
    insertFavorite,
    isFavorite,
    listBatches,
    listFavorites,
    readMeta,
    trimBatches,
    writeMeta,
} from './db/namingRepository'
import { generateNames } from './generator'
import { normalizeNamingRequest } from './request'
import type { NamingBatchRow } from './db/namingRepository'
import type {
    NamingCatalog,
    NamingCategory,
    NamingCategoryMeta,
    NamingFavoriteItem,
    NamingGenerateResult,
    NamingHistoryEntry,
    NamingRequest,
} from '../../shared/types/naming'
import type { SecretsService } from '../common/secrets'
import type Database from 'better-sqlite3'
import { getZhaiConfig } from '../common/config'

/** 历史保留批次上限 */
const HISTORY_LIMIT = 200
/** 历史列表默认返回条数 */
const HISTORY_PAGE_SIZE = 50
/** 生成前参考的近期批次数（用于跨批次去重） */
const RECENT_BATCH_LIMIT = 3
/** 姓氏抽样数量：界面「随机」按钮只需少量样本 */
const SURNAME_SAMPLE_SIZE = 80
/** AI 次数配额的日期键（naming.db 的 meta 表） */
const AI_QUOTA_DATE_KEY = 'naming_ai_date'
/** AI 次数配额的计数键 */
const AI_QUOTA_COUNT_KEY = 'naming_ai_count'

export class NamingService {
    /** 进行中的 AI 生成请求：用于 naming/abort 取消 */
    private activeAiRequest: AbortController | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly secrets: SecretsService,
    ) {}

    /** 选项摘要：分类、枚举、后缀候选、姓氏抽样与 AI 可用性 */
    public async getCatalog(): Promise<NamingCatalog> {
        const apiKey = await this.secrets.get('deepseekApiKey')
        return {
            categories: NAMING_CATEGORIES.map((item): NamingCategoryMeta => ({
                value: item.value,
                label: item.label,
                variantLabel: item.variantLabel,
                variants: [...item.variants],
                isPerson: item.isPerson,
                hasSuffix: item.hasSuffix,
                suffixPlaceholder: item.suffixPlaceholder,
            })),
            eras: [...ERA_OPTIONS],
            references: [...REFERENCE_OPTIONS],
            genders: [...GENDER_OPTIONS],
            lengths: [...LENGTH_OPTIONS],
            surnameKinds: [...SURNAME_KIND_OPTIONS],
            counts: [...NAME_COUNTS],
            suffixSamples: buildSuffixSamples(),
            surnameSamples: {
                single: [...CN_SINGLE_SURNAMES].slice(0, SURNAME_SAMPLE_SIZE),
                compound: [...CN_COMPOUND_SURNAMES],
            },
            aiAvailable: typeof apiKey === 'string' && apiKey.length > 0,
        }
    }

    /** 本地生成一批名字并落库 */
    public generate(payload: unknown): NamingGenerateResult {
        const request = normalizeNamingRequest(payload)
        const exclude = this.readRecentNames(request.category)
        const items = generateNames({ request, exclude })
        this.record({ ...request, source: 'local' }, items.map((item) => item.name))
        return { items, source: 'local' }
    }

    /**
     * AI 生成一批名字：校验密钥与每日配额 → 请求模型 → 校验结果 → 落库。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、结果全部不合规时抛出可读错误
     */
    public async generateWithAi(payload: unknown): Promise<NamingGenerateResult> {
        if (this.activeAiRequest) {
            throw new Error('已有生成中的 AI 取名请求，请等待完成或先取消')
        }
        const request = normalizeNamingRequest(payload)
        const apiKey = await this.secrets.get('deepseekApiKey')
        if (!apiKey) {
            throw new Error('未配置 DeepSeek API Key，请先在插件设置中配置后重试')
        }
        this.assertAiQuota()
        const controller = new AbortController()
        this.activeAiRequest = controller
        try {
            const result = await generateNamesWithAi({
                apiKey,
                model: getZhaiConfig().aiModel,
                request,
                signal: controller.signal,
            })
            const items = parseNamingResponse(result.content, request)
            if (items.length === 0) {
                throw new Error('AI 未返回合规的名字，请调整条件后重试或改用本地生成')
            }
            this.record({ ...request, source: 'ai' }, items.map((item) => item.name))
            this.consumeAiQuota()
            return { items, source: 'ai' }
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error('AI 取名已取消或超时，请重试或改用本地生成', { cause: error })
            }
            throw error
        } finally {
            this.activeAiRequest = null
        }
    }

    /** 取消进行中的 AI 生成 */
    public abortAi(): { aborted: boolean } {
        if (!this.activeAiRequest) {
            return { aborted: false }
        }
        this.activeAiRequest.abort()
        return { aborted: true }
    }

    /** 历史批次：按时间倒序 */
    public listHistory(limit: number = HISTORY_PAGE_SIZE): NamingHistoryEntry[] {
        const size = Math.min(Math.max(limit, 1), HISTORY_LIMIT)
        return listBatches(this.db, size).map(toHistoryEntry)
    }

    /** 清空全部历史 */
    public clearHistory(): { cleared: number } {
        return { cleared: clearBatches(this.db) }
    }

    /** 切换收藏状态 */
    public toggleFavorite(name: string, category: NamingCategory, createdAt: string = new Date().toISOString()): { favorited: boolean } {
        if (isFavorite(this.db, name, category)) {
            deleteFavorite(this.db, name, category)
            return { favorited: false }
        }
        insertFavorite(this.db, { name, category, createdAt })
        return { favorited: true }
    }

    /** 收藏列表 */
    public listFavorites(): NamingFavoriteItem[] {
        return listFavorites(this.db, HISTORY_LIMIT).map((row) => ({
            name: row.name,
            category: row.category as NamingCategory,
            createdAt: row.createdAt,
        }))
    }

    /** 校验今日 AI 次数：限额为 0 或负数时视为不限制 */
    private assertAiQuota(): void {
        const limit = getZhaiConfig().namingAiDailyLimit
        if (limit <= 0) {
            return
        }
        const used = this.readAiUsedToday()
        if (used >= limit) {
            throw new Error(`今日 AI 取名次数已用完（${used} / ${limit}），可使用本地生成或明日再试`)
        }
    }

    /** 读取今日已用次数：日期不一致时视为 0 */
    private readAiUsedToday(): number {
        if (readMeta(this.db, AI_QUOTA_DATE_KEY) !== todayKey()) {
            return 0
        }
        const raw = readMeta(this.db, AI_QUOTA_COUNT_KEY)
        const parsed = raw ? Number.parseInt(raw, 10) : 0
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }

    /** 记录一次成功生成 */
    private consumeAiQuota(): void {
        const used = this.readAiUsedToday()
        writeMeta(this.db, AI_QUOTA_DATE_KEY, todayKey())
        writeMeta(this.db, AI_QUOTA_COUNT_KEY, String(used + 1))
    }

    /** 读取近期同分类结果，作为新一批次的去重集合 */
    private readRecentNames(category: NamingCategory): string[] {
        const rows = listBatches(this.db, RECENT_BATCH_LIMIT * 4).filter((row) => row.category === category)
        const names: string[] = []
        for (const row of rows.slice(0, RECENT_BATCH_LIMIT)) {
            for (const name of parseResults(row)) {
                names.push(name)
            }
        }
        return names
    }

    /** 落库并裁剪历史 */
    private record(request: NamingRequest, names: readonly string[]): void {
        insertBatch(this.db, {
            id: randomUUID(),
            category: request.category,
            source: request.source,
            params: JSON.stringify(request),
            results: JSON.stringify(names),
            createdAt: new Date().toISOString(),
        })
        trimBatches(this.db, HISTORY_LIMIT)
    }
}

/** 后缀候选表：键为 `${category}:${variant}`，人物为空数组 */
function buildSuffixSamples(): Record<string, string[]> {
    const samples: Record<string, string[]> = {}
    for (const category of NAMING_CATEGORIES) {
        for (const variant of category.variants) {
            const key = `${category.value}:${variant.value}`
            samples[key] = [...(ENTITY_SUFFIXES[key] ?? [])]
        }
    }
    return samples
}

/** 批次行转历史项：解析失败时降级为分类名摘要，不抛错影响列表 */
function toHistoryEntry(row: NamingBatchRow): NamingHistoryEntry {
    return {
        id: row.id,
        category: row.category as NamingCategory,
        source: row.source === 'ai' ? 'ai' : 'local',
        names: parseResults(row),
        summary: describeParams(row.params, row.category as NamingCategory),
        createdAt: row.createdAt,
    }
}

/** 解析结果 JSON */
function parseResults(row: NamingBatchRow): string[] {
    try {
        const parsed: unknown = JSON.parse(row.results)
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
        return []
    }
}

/** 本地日期键：YYYY-MM-DD，用于 AI 每日次数配额 */
function todayKey(): string {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

/** 条件摘要：分类 · 变体 · 姓氏 / 后缀 / 具体要求 */
function describeParams(paramsText: string, category: NamingCategory): string {
    const definition = readCategoryDefinition(category)
    let params: Partial<NamingRequest> = {}
    try {
        const parsed: unknown = JSON.parse(paramsText)
        if (typeof parsed === 'object' && parsed !== null) {
            params = parsed
        }
    } catch {
        return definition.label
    }
    const [firstVariant] = definition.variants
    const variantLabel =
        definition.variants.find((variant) => variant.value === params.variant)?.label ?? firstVariant?.label ?? ''
    const parts = [`${definition.label} · ${variantLabel}`]
    if (typeof params.surname === 'string' && params.surname.length > 0) {
        parts.push(`姓氏：${params.surname}`)
    }
    if (typeof params.suffix === 'string' && params.suffix.length > 0) {
        parts.push(`后缀：${params.suffix}`)
    }
    if (typeof params.requirement === 'string' && params.requirement.length > 0) {
        parts.push(params.requirement)
    }
    return parts.join(' · ')
}
