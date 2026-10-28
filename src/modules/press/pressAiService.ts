/**
 * 写作管理 AI 服务：校验密钥与每日配额后执行一次性生成，承载人物外貌、设定字段与条目描述。
 * 复用约定：模型通道经注入的 AI 通道（../ai/provider）驱动 ./ai/aiTextGenerator，
 * 提示词分别来自 ./ai/appearancePrompt、./ai/settingFieldPrompt 与 ./ai/lorePrompt，输出统一经 ./ai/plainText 清洗；
 * 配额经 ../common/db/quotaRepository 落在 press.db 的 meta 表，三类生成共用同一份额度与统计口径；
 * 入参收窄复用 ../common/readInput，不在此重复实现截断与去重。
 * 关键约束：入参一律先经 normalize*Request 收窄（长度、条数、类型、字段白名单），异常载荷不进入模型调用；
 * 同一时刻只允许一个生成请求，取消由三类生成各自的 abort 方法触发；
 * 限额小于等于 0 视为不限制。
 */
import type { AiChatMessage, AiProvider } from '@modules/ai/provider'
import { getSelectedCodebuddyModel } from '@modules/ai/providers/codebuddyModels'
import type { UsageRecorder } from '@modules/ai/usageRecorder'
import { summarizeMessages } from '@modules/ai/usageRecorder'
import { getZhaiConfig } from '@modules/common/config'
import type { QuotaKeys } from '@modules/common/db/quotaRepository'
import { consumeToday, readUsedToday } from '@modules/common/db/quotaRepository'
import { readText, readTextList } from '@modules/common/readInput'
import { PRESS_LORE_KINDS, SETTING_FIELD_KEYS } from '@shared/types/press'
import type {
    CharacterAppearanceRequest,
    CharacterAppearanceResult,
    LoreDescriptionGenerateRequest,
    LoreDescriptionGenerateResult,
    SettingFieldGenerateRequest,
    SettingFieldGenerateResult,
    SettingSnapshot,
} from '@shared/types/press'
import { generateTextWithAi } from './ai/aiTextGenerator'
import { buildAppearanceMessages } from './ai/appearancePrompt'
import { buildLoreDescriptionMessages } from './ai/lorePrompt'
import { sanitizePlainText } from './ai/plainText'
import { buildSettingFieldMessages } from './ai/settingFieldPrompt'
import type { AiTextGenerateResult } from './ai/aiTextGenerator'
import type Database from 'better-sqlite3'

/** 生成配额键（press.db 的 meta 表）：外貌与设定字段共用同一份每日额度 */
const QUOTA_KEYS: QuotaKeys = { dateKey: 'press_ai_date', countKey: 'press_ai_count' }
/** 短字段长度上限：人物名、身份、作品名、时代等 */
const MAX_SHORT_TEXT = 64
/** 描述字段长度上限：欲望、弱点、能力等 */
const MAX_LONG_TEXT = 200
/** 设定长文本上限：简介、世界观等字段本身可以更长 */
const MAX_SETTING_LONG_TEXT = 400
/** 已写外貌：作为补充传入，允许比其它描述字段长一截 */
const MAX_APPEARANCE_TEXT = 400
/** 性格标签条数与单条长度 */
const MAX_TRAIT_COUNT = 8
const MAX_TRAIT_LENGTH = 16
/** 外貌标签条数与单条长度：与前端 APPEARANCE_TAG_MAX_COUNT 同口径 */
const MAX_APPEARANCE_TAG_COUNT = 24
const MAX_APPEARANCE_TAG_LENGTH = 16
/** 题材条数与单条长度 */
const MAX_GENRE_COUNT = 6
const MAX_GENRE_LENGTH = 16
/** 外貌输出上限、超时与 token：标签较多时要写满，留足余量 */
const MAX_APPEARANCE_LENGTH = 700
const APPEARANCE_TIMEOUT_MS = 60_000
const APPEARANCE_MAX_TOKENS = 800
/** 设定字段输出上限、超时与 token：简介最长，其余字段更短 */
const MAX_SETTING_FIELD_LENGTH = 700
const SETTING_FIELD_TIMEOUT_MS = 45_000
const SETTING_FIELD_MAX_TOKENS = 700
/** 条目描述输出上限、超时与 token：与设定字段同档，描述最长 */
const MAX_LORE_DESCRIPTION_LENGTH = 700
const LORE_DESCRIPTION_TIMEOUT_MS = 45_000
const LORE_DESCRIPTION_MAX_TOKENS = 700
/** 条目请求里的参照名单条数上限：同类条目名与关联人物名各自收口 */
const MAX_LORE_REFERENCE_COUNT = 50

/** 一次文本生成的运行参数：三类生成只差提示词、篇幅与提示文案 */
interface GenerationOptions {
    /** 用量模块：条目描述复用设定生成的统计口径 */
    module: 'appearance' | 'setting'
    messages: AiChatMessage[]
    maxTokens: number
    timeoutMs: number
    /** 清洗后的正文长度上限 */
    maxLength: number
    /** 输出为空时的提示 */
    emptyMessage: string
    /** 超时或取消时的提示 */
    abortMessage: string
}

export class PressAiService {
    /** 进行中的生成请求：用于 abort 两类生成 */
    private activeRequest: AbortController | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly provider: AiProvider,
        private readonly usageRecorder: UsageRecorder,
    ) {}

    /**
     * 生成人物外貌：校验密钥与每日配额 → 请求模型 → 清洗输出 → 计数。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateAppearance(payload: unknown): Promise<CharacterAppearanceResult> {
        const content = await this.runGeneration({
            module: 'appearance',
            messages: buildAppearanceMessages(normalizeAppearanceRequest(payload)),
            maxTokens: APPEARANCE_MAX_TOKENS,
            timeoutMs: APPEARANCE_TIMEOUT_MS,
            maxLength: MAX_APPEARANCE_LENGTH,
            emptyMessage: 'AI 未返回可用的外貌描写，请重试或手动填写',
            abortMessage: 'AI 外貌生成已取消或超时，请重试',
        })
        return { content }
    }

    /**
     * 生成设定页的单个字段：以其它已填字段为依据，必要时在已有草稿上完善。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateSettingField(payload: unknown): Promise<SettingFieldGenerateResult> {
        const content = await this.runGeneration({
            module: 'setting',
            messages: buildSettingFieldMessages(normalizeSettingFieldRequest(payload)),
            maxTokens: SETTING_FIELD_MAX_TOKENS,
            timeoutMs: SETTING_FIELD_TIMEOUT_MS,
            maxLength: MAX_SETTING_FIELD_LENGTH,
            emptyMessage: 'AI 未返回可用的内容，请重试或手动填写',
            abortMessage: 'AI 设定生成已取消或超时，请重试',
        })
        return { content }
    }

    /**
     * 生成资料条目的描述：以条目名称、已有草稿与整份设定为依据，必要时在草稿上完善。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateLoreDescription(payload: unknown): Promise<LoreDescriptionGenerateResult> {
        const content = await this.runGeneration({
            module: 'setting',
            messages: buildLoreDescriptionMessages(normalizeLoreDescriptionRequest(payload)),
            maxTokens: LORE_DESCRIPTION_MAX_TOKENS,
            timeoutMs: LORE_DESCRIPTION_TIMEOUT_MS,
            maxLength: MAX_LORE_DESCRIPTION_LENGTH,
            emptyMessage: 'AI 未返回可用的条目描述，请重试或手动填写',
            abortMessage: 'AI 条目生成已取消或超时，请重试',
        })
        return { content }
    }

    /** 执行一次文本生成：占请求位 → 请求模型 → 清洗 → 计次记账，三类生成共用同一套流程 */
    private async runGeneration(options: GenerationOptions): Promise<string> {
        const controller = await this.startRequest()
        try {
            const result = await generateTextWithAi({
                provider: this.provider,
                model: getSelectedCodebuddyModel(),
                messages: options.messages,
                maxTokens: options.maxTokens,
                timeoutMs: options.timeoutMs,
                signal: controller.signal,
            })
            const content = sanitizePlainText(result.content, options.maxLength)
            if (content.length === 0) {
                throw new Error(options.emptyMessage)
            }
            this.commit(options.module, options.messages, result)
            return content
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(options.abortMessage, { cause: error })
            }
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /** 取消进行中的生成：三类生成共用同一个在途请求 */
    public abortGeneration(): { aborted: boolean } {
        if (!this.activeRequest) {
            return { aborted: false }
        }
        this.activeRequest.abort()
        return { aborted: true }
    }

    /** 生成前置：并发、通道就绪与配额三关都过了才占用请求位 */
    private async startRequest(): Promise<AbortController> {
        if (this.activeRequest) {
            throw new Error('已有一项 AI 生成正在进行，请等待完成或先取消')
        }
        const status = await this.provider.checkReady()
        if (!status.ready) {
            throw new Error(status.reason ?? 'AI 通道未就绪，请先在插件设置中完成配置')
        }
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        return controller
    }

    /** 成功后计次与记账：两类生成只差 module 与提示词 */
    private commit(module: 'appearance' | 'setting', messages: AiChatMessage[], result: AiTextGenerateResult): void {
        consumeToday(this.db, QUOTA_KEYS)
        this.usageRecorder.record({
            module,
            model: getSelectedCodebuddyModel(),
            usage: result.usage,
            meta: result.meta,
            prompt: summarizeMessages(messages),
        })
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制 */
    private assertQuota(): void {
        const limit = getZhaiConfig().pressAiDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日 AI 生成次数已用完（${used} / ${limit}），可手动填写或明日再试`)
        }
    }
}

/** 入参收窄：字段逐个取值并截断，姓名为空时直接拒绝 */
function normalizeAppearanceRequest(payload: unknown): CharacterAppearanceRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiAppearance 缺少参数')
    }
    const value = payload as {
        name?: unknown
        role?: unknown
        gender?: unknown
        age?: unknown
        identity?: unknown
        appearanceTags?: unknown
        appearance?: unknown
        traits?: unknown
        desire?: unknown
        weakness?: unknown
        ability?: unknown
        era?: unknown
        genres?: unknown
        tone?: unknown
    }
    const request: CharacterAppearanceRequest = {
        name: readText(value.name, MAX_SHORT_TEXT),
        role: readText(value.role, MAX_SHORT_TEXT),
        gender: readText(value.gender, MAX_SHORT_TEXT),
        age: readText(value.age, MAX_SHORT_TEXT),
        identity: readText(value.identity, MAX_SHORT_TEXT),
        appearanceTags: readTextList(value.appearanceTags, MAX_APPEARANCE_TAG_COUNT, MAX_APPEARANCE_TAG_LENGTH),
        appearance: readText(value.appearance, MAX_APPEARANCE_TEXT),
        traits: readTextList(value.traits, MAX_TRAIT_COUNT, MAX_TRAIT_LENGTH),
        desire: readText(value.desire, MAX_LONG_TEXT),
        weakness: readText(value.weakness, MAX_LONG_TEXT),
        ability: readText(value.ability, MAX_LONG_TEXT),
        era: readText(value.era, MAX_SHORT_TEXT),
        genres: readTextList(value.genres, MAX_GENRE_COUNT, MAX_GENRE_LENGTH),
        tone: readText(value.tone, MAX_SHORT_TEXT),
    }
    if (request.name.length === 0) {
        throw new Error('缺少人物姓名，无法生成外貌')
    }
    return request
}

/** 入参收窄：目标字段必须在白名单内，其余字段按设定快照处理 */
function normalizeSettingFieldRequest(payload: unknown): SettingFieldGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiSettingField 缺少参数')
    }
    const value = payload as Record<string, unknown>
    const rawField = readText(value.field, MAX_SHORT_TEXT)
    const field = SETTING_FIELD_KEYS.find((item) => item === rawField)
    if (field === undefined) {
        throw new Error('缺少要生成的设定字段')
    }
    return { field, ...normalizeSettingSnapshot(value) }
}

/**
 * 设定快照收窄：字段逐个截断，缺字段按空串处理。
 * 设定字段与条目描述两类生成共用同一份，保证进提示词的事实行口径一致。
 */
function normalizeSettingSnapshot(value: Record<string, unknown>): SettingSnapshot {
    return {
        title: readText(value.title, MAX_SHORT_TEXT),
        penName: readText(value.penName, MAX_SHORT_TEXT),
        audience: readText(value.audience, MAX_SHORT_TEXT),
        genres: readTextList(value.genres, MAX_GENRE_COUNT, MAX_GENRE_LENGTH),
        period: readText(value.period, MAX_SHORT_TEXT),
        place: readText(value.place, MAX_SHORT_TEXT),
        era: readText(value.era, MAX_SHORT_TEXT),
        tone: readText(value.tone, MAX_SHORT_TEXT),
        ending: readText(value.ending, MAX_SHORT_TEXT),
        perspective: readText(value.perspective, MAX_SHORT_TEXT),
        narrative: readText(value.narrative, MAX_SHORT_TEXT),
        references: readText(value.references, MAX_LONG_TEXT),
        summary: readText(value.summary, MAX_SETTING_LONG_TEXT),
        logline: readText(value.logline, MAX_LONG_TEXT),
        opening: readText(value.opening, MAX_SETTING_LONG_TEXT),
        conflict: readText(value.conflict, MAX_LONG_TEXT),
        worldview: readText(value.worldview, MAX_SETTING_LONG_TEXT),
        geography: readText(value.geography, MAX_SETTING_LONG_TEXT),
        factions: readText(value.factions, MAX_SETTING_LONG_TEXT),
        powerSystem: readText(value.powerSystem, MAX_SETTING_LONG_TEXT),
        concepts: readText(value.concepts, MAX_SETTING_LONG_TEXT),
        goldenFingerType: readText(value.goldenFingerType, MAX_SHORT_TEXT),
        goldenFingerAbility: readText(value.goldenFingerAbility, MAX_LONG_TEXT),
        goldenFingerCost: readText(value.goldenFingerCost, MAX_LONG_TEXT),
        extra: readText(value.extra, MAX_SETTING_LONG_TEXT),
    }
}

/** 入参收窄：分类与名称必填，参照名单去空截断，其余字段按设定快照处理 */
function normalizeLoreDescriptionRequest(payload: unknown): LoreDescriptionGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiLoreDescription 缺少参数')
    }
    const value = payload as Record<string, unknown>
    const rawKind = readText(value.kind, MAX_SHORT_TEXT)
    const kind = PRESS_LORE_KINDS.find((item) => item === rawKind)
    if (kind === undefined) {
        throw new Error('缺少条目分类')
    }
    const name = readText(value.name, MAX_SHORT_TEXT)
    if (name.length === 0) {
        throw new Error('缺少条目名称，无法生成描述')
    }
    return {
        ...normalizeSettingSnapshot(value),
        kind,
        name,
        description: readText(value.description, MAX_SETTING_LONG_TEXT),
        siblings: readTextList(value.siblings, MAX_LORE_REFERENCE_COUNT, MAX_SHORT_TEXT),
        members: readTextList(value.members, MAX_LORE_REFERENCE_COUNT, MAX_SHORT_TEXT),
    }
}
