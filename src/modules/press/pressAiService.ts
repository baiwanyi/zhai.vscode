/**
 * 写作管理 AI 服务：校验密钥与每日配额后执行一次性生成，承载人物外貌、设定字段、条目描述、
 * 按卷生成章纲、按作品设定生成卷纲与卷纲单字段（核心事件 / 卷末结果）。
 * 复用约定：模型通道经注入的 AI 通道（../ai/provider）驱动 ./ai/aiTextGenerator，
 * 提示词分别来自 ./ai/appearancePrompt、./ai/settingFieldPrompt、./ai/lorePrompt 与 ./ai/volumeChaptersPrompt，
 * 纯文本输出统一经 ./ai/plainText 清洗；按卷章纲是多字段结构，走单独的 JSON 解析与逐项截断；
 * 配额经 ../common/db/quotaRepository 落在 press.db 的 meta 表，四类生成共用同一份每日额度（统计模块各自独立）；
 * 入参收窄复用 ../common/readInput，不在此重复实现截断与去重。
 * 关键约束：入参一律先经 normalize*Request 收窄（长度、条数、类型、字段白名单），异常载荷不进入模型调用；
 * 同一时刻只允许一个生成请求，取消由各类生成各自的 abort 方法触发；
 * 限额小于等于 0 视为不限制；模型输出一律视为不可信，JSON 解析失败按空结果返回而不抛出解析细节。
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
    VolumeChapterDraft,
    VolumeChaptersGenerateRequest,
    VolumeChaptersGenerateResult,
    VolumeFieldGenerateRequest,
    VolumeFieldGenerateResult,
    VolumeFieldKey,
    VolumeOutlineDraft,
    VolumeOutlinesGenerateRequest,
    VolumeOutlinesGenerateResult,
} from '@shared/types/press'
import { generateTextWithAi } from './ai/aiTextGenerator'
import { buildAppearanceMessages } from './ai/appearancePrompt'
import { buildLoreDescriptionMessages } from './ai/lorePrompt'
import { sanitizePlainText } from './ai/plainText'
import { buildSettingFieldMessages } from './ai/settingFieldPrompt'
import { buildVolumeChaptersMessages } from './ai/volumeChaptersPrompt'
import { buildVolumeFieldMessages } from './ai/volumeFieldPrompt'
import { buildVolumeOutlinesMessages } from './ai/volumeOutlinesPrompt'
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
/** 按卷生成章纲：卷纲入参上限、产出条数上限与单章文本上限 */
const MAX_VOLUME_TEXT = 400
const MAX_VOLUME_PLOTLINE = 4_000
const MAX_VOLUME_CHAPTERS = 120
const MAX_VOLUME_CHAPTER_TITLE = 40
const MAX_VOLUME_CHAPTER_SUMMARY = 300
const MAX_VOLUME_CAST_COUNT = 30
/** 按卷生成章纲的输出上限、超时与 token：整卷几十章，需要比单字段生成大得多的余量 */
const MAX_VOLUME_CHAPTERS_OUTPUT = 60_000
const VOLUME_CHAPTERS_TIMEOUT_MS = 180_000
const VOLUME_CHAPTERS_MAX_TOKENS = 8_000
/** 按作品设定生成卷纲：卷数上限、各字段长度与输出上限 */
const MAX_OUTLINE_VOLUME_COUNT = 20
const MAX_OUTLINE_VOLUME_NAME = 40
const MAX_OUTLINE_CORE_EVENT = 400
const MAX_OUTLINE_MAIN_PLOT = 12
const MAX_OUTLINE_TURNING_POINTS = 8
const MAX_OUTLINE_RESULT = 300
const MAX_OUTLINE_VOLUMES_OUTPUT = 20_000
const VOLUME_OUTLINES_TIMEOUT_MS = 120_000
const VOLUME_OUTLINES_MAX_TOKENS = 4_000
/** 卷纲单字段：输出上限按输入框口径截断（核心事件 200 字、卷末结果 300 字） */
const MAX_VOLUME_FIELD_CORE_EVENT = 200
const MAX_VOLUME_FIELD_RESULT = 300
const VOLUME_FIELD_TIMEOUT_MS = 45_000
const VOLUME_FIELD_MAX_TOKENS = 700

/** 一次文本生成的运行参数：各类生成只差提示词、篇幅、模块与提示文案 */
interface GenerationOptions {
    /** 用量模块：各类生成分别记账，配额仍共用 press_ai */
    module: 'appearance' | 'setting' | 'lore' | 'outline'
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
        /** 库按需打开：装配期只登记取值方式，激活不付打开与建表的磁盘开销 */
        private readonly db: () => Database.Database,
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
            module: 'lore',
            messages: buildLoreDescriptionMessages(normalizeLoreDescriptionRequest(payload)),
            maxTokens: LORE_DESCRIPTION_MAX_TOKENS,
            timeoutMs: LORE_DESCRIPTION_TIMEOUT_MS,
            maxLength: MAX_LORE_DESCRIPTION_LENGTH,
            emptyMessage: 'AI 未返回可用的条目描述，请重试或手动填写',
            abortMessage: 'AI 条目生成已取消或超时，请重试',
        })
        return { content }
    }

    /**
     * 按卷生成章纲：以作者写好的卷纲为骨架，产出「阶段 / 标题 / 介绍」三元组数组。
     * 关键约束：输出是多条结构，统一走 JSON 解析与逐项截断；解析不出结果时返回空数组，
     * 由前端提示「检查卷纲或重试」，不把模型原文直接抛给页面。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateVolumeChapters(payload: unknown): Promise<VolumeChaptersGenerateResult> {
        const request = normalizeVolumeChaptersRequest(payload)
        const content = await this.runGeneration({
            module: 'outline',
            messages: buildVolumeChaptersMessages(request),
            maxTokens: VOLUME_CHAPTERS_MAX_TOKENS,
            timeoutMs: VOLUME_CHAPTERS_TIMEOUT_MS,
            maxLength: MAX_VOLUME_CHAPTERS_OUTPUT,
            emptyMessage: 'AI 未返回可用的章纲，请重试或先补充卷纲',
            abortMessage: 'AI 章纲生成已取消或超时，请重试',
        })
        return { chapters: parseVolumeChapterDrafts(content) }
    }

    /**
     * 按作品设定生成卷纲：产出卷名、预计章节数与卷纲五项，供前端预览后覆盖卷纲。
     * 关键约束：只覆盖卷纲字段，不触碰章节；解析不出结果时返回空数组，由前端提示重试。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateVolumeOutlines(payload: unknown): Promise<VolumeOutlinesGenerateResult> {
        const request = normalizeVolumeOutlinesRequest(payload)
        const content = await this.runGeneration({
            module: 'outline',
            messages: buildVolumeOutlinesMessages(request),
            maxTokens: VOLUME_OUTLINES_MAX_TOKENS,
            timeoutMs: VOLUME_OUTLINES_TIMEOUT_MS,
            maxLength: MAX_OUTLINE_VOLUMES_OUTPUT,
            emptyMessage: 'AI 未返回可用的卷纲，请重试或先补全作品设定',
            abortMessage: 'AI 卷纲生成已取消或超时，请重试',
        })
        return { volumes: parseVolumeOutlineDrafts(content) }
    }

    /**
     * 卷纲单字段生成：只补「核心事件」或「卷末结果」，其余字段作为上下文。
     * 关键约束：输出按输入框的字数口径截断，避免写回后超长；不修改调用方的其它字段。
     * @throws 未配置密钥、配额用尽、请求超时 / 取消、输出为空时抛出可读错误
     */
    public async generateVolumeField(payload: unknown): Promise<VolumeFieldGenerateResult> {
        const request = normalizeVolumeFieldRequest(payload)
        const content = await this.runGeneration({
            module: 'outline',
            messages: buildVolumeFieldMessages(request),
            maxTokens: VOLUME_FIELD_MAX_TOKENS,
            timeoutMs: VOLUME_FIELD_TIMEOUT_MS,
            maxLength: request.field === 'coreEvent' ? MAX_VOLUME_FIELD_CORE_EVENT : MAX_VOLUME_FIELD_RESULT,
            emptyMessage: 'AI 未返回可用的内容，请重试',
            abortMessage: 'AI 生成已取消或超时，请重试',
        })
        return { content }
    }

    /** 执行一次文本生成：占请求位 → 请求模型 → 清洗 → 计次记账，各类生成共用同一套流程 */
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

    /** 成功后计次与记账：三类生成只差 module 与提示词 */
    private commit(module: GenerationOptions['module'], messages: AiChatMessage[], result: AiTextGenerateResult): void {
        consumeToday(this.db(), QUOTA_KEYS)
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
        const used = readUsedToday(this.db(), QUOTA_KEYS)
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
        theme: readText(value.theme, MAX_LONG_TEXT),
        arc: readText(value.arc, MAX_LONG_TEXT),
        worldview: readText(value.worldview, MAX_SETTING_LONG_TEXT),
        geography: readText(value.geography, MAX_SETTING_LONG_TEXT),
        factions: readText(value.factions, MAX_SETTING_LONG_TEXT),
        powerSystem: readText(value.powerSystem, MAX_SETTING_LONG_TEXT),
        concepts: readText(value.concepts, MAX_SETTING_LONG_TEXT),
        taboo: readText(value.taboo, MAX_SETTING_LONG_TEXT),
        goldenFingerType: readText(value.goldenFingerType, MAX_SHORT_TEXT),
        goldenFingerAbility: readText(value.goldenFingerAbility, MAX_LONG_TEXT),
        goldenFingerCost: readText(value.goldenFingerCost, MAX_LONG_TEXT),
        goldenFingerLimit: readText(value.goldenFingerLimit, MAX_LONG_TEXT),
        goldenFingerUpgrade: readText(value.goldenFingerUpgrade, MAX_LONG_TEXT),
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

/** 计数入参：非数字或负数回落 fallback，超出上限按上限截断 */
function readCount(value: unknown, fallback: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.NaN
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback
    }
    return Math.min(Math.floor(parsed), max)
}

/** 入参收窄：卷名必填，卷纲各字段按上限截断，设定快照复用同一份收窄逻辑 */
function normalizeVolumeChaptersRequest(payload: unknown): VolumeChaptersGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiVolumeChapters 缺少参数')
    }
    const value = payload as Record<string, unknown>
    const volumeName = readText(value.volumeName, MAX_SHORT_TEXT)
    if (volumeName.length === 0) {
        throw new Error('缺少卷名，无法生成章纲')
    }
    const setting =
        typeof value.setting === 'object' && value.setting !== null
            ? normalizeSettingSnapshot(value.setting as Record<string, unknown>)
            : normalizeSettingSnapshot({})
    return {
        volumeName,
        coreEvent: readText(value.coreEvent, MAX_VOLUME_PLOTLINE),
        mainPlot: readTextList(value.mainPlot, 40, MAX_VOLUME_TEXT),
        turningPoints: readTextList(value.turningPoints, 12, MAX_VOLUME_TEXT),
        result: readText(value.result, MAX_VOLUME_TEXT),
        startOrder: readCount(value.startOrder, 1, MAX_VOLUME_CHAPTERS * 10),
        chapterCount: readCount(value.chapterCount, 0, MAX_VOLUME_CHAPTERS),
        existingCount: readCount(value.existingCount, 0, MAX_VOLUME_CHAPTERS * 10),
        setting,
        characters: readTextList(value.characters, MAX_VOLUME_CAST_COUNT, MAX_SHORT_TEXT),
    }
}

/** 入参收窄：卷数为 0 表示由模型自定，已有卷名与人物名单按条数与长度截断 */
function normalizeVolumeOutlinesRequest(payload: unknown): VolumeOutlinesGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiVolumeOutlines 缺少参数')
    }
    const value = payload as Record<string, unknown>
    const setting =
        typeof value.setting === 'object' && value.setting !== null
            ? normalizeSettingSnapshot(value.setting as Record<string, unknown>)
            : normalizeSettingSnapshot({})
    return {
        volumeCount: readCount(value.volumeCount, 0, MAX_OUTLINE_VOLUME_COUNT),
        existingNames: readTextList(value.existingNames, MAX_OUTLINE_VOLUME_COUNT, MAX_OUTLINE_VOLUME_NAME),
        setting,
        characters: readTextList(value.characters, MAX_VOLUME_CAST_COUNT, MAX_SHORT_TEXT),
    }
}

/** 入参收窄：字段只认 coreEvent / result，卷现状按各自上限截断 */
function normalizeVolumeFieldRequest(payload: unknown): VolumeFieldGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiVolumeField 缺少参数')
    }
    const value = payload as Record<string, unknown>
    const field: VolumeFieldKey = value.field === 'result' ? 'result' : 'coreEvent'
    const setting =
        typeof value.setting === 'object' && value.setting !== null
            ? normalizeSettingSnapshot(value.setting as Record<string, unknown>)
            : normalizeSettingSnapshot({})
    return {
        field,
        volumeName: readText(value.volumeName, MAX_SHORT_TEXT),
        coreEvent: readText(value.coreEvent, MAX_OUTLINE_CORE_EVENT),
        mainPlot: readTextList(value.mainPlot, MAX_OUTLINE_MAIN_PLOT, MAX_VOLUME_TEXT),
        turningPoints: readTextList(value.turningPoints, MAX_OUTLINE_TURNING_POINTS, MAX_VOLUME_TEXT),
        result: readText(value.result, MAX_OUTLINE_RESULT),
        setting,
        characters: readTextList(value.characters, MAX_VOLUME_CAST_COUNT, MAX_SHORT_TEXT),
    }
}

/**
 * 解析模型输出的卷纲数组：容忍代码围栏与前后说明文字，只截取第一个 [ 到最后一个 ]。
 * 关键约束：卷名为空时丢弃该条；章数与各字段按上限截断，解析失败返回空数组。
 */
function parseVolumeOutlineDrafts(content: string): VolumeOutlineDraft[] {
    const start = content.indexOf('[')
    const end = content.lastIndexOf(']')
    if (start < 0 || end <= start) {
        return []
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(content.slice(start, end + 1))
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    const drafts: VolumeOutlineDraft[] = []
    for (const item of parsed.slice(0, MAX_OUTLINE_VOLUME_COUNT)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as {
            name?: unknown
            expectedChapters?: unknown
            coreEvent?: unknown
            mainPlot?: unknown
            turningPoints?: unknown
            result?: unknown
        }
        const name = readText(record.name, MAX_OUTLINE_VOLUME_NAME)
        if (name.length === 0) {
            continue
        }
        drafts.push({
            name,
            expectedChapters: readCount(record.expectedChapters, 0, MAX_VOLUME_CHAPTERS),
            coreEvent: readText(record.coreEvent, MAX_OUTLINE_CORE_EVENT),
            mainPlot: readTextList(record.mainPlot, MAX_OUTLINE_MAIN_PLOT, MAX_VOLUME_TEXT),
            turningPoints: readTextList(record.turningPoints, MAX_OUTLINE_TURNING_POINTS, MAX_VOLUME_TEXT),
            result: readText(record.result, MAX_OUTLINE_RESULT),
        })
    }
    return drafts
}

/**
 * 解析模型输出的章纲数组：容忍代码围栏与前后说明文字，只截取第一个 [ 到最后一个 ]。
 * 关键约束：单条结构不完整时丢弃该条，不猜测字段；标题去掉「第N章」前缀，避免与章序重复；
 * 解析失败返回空数组，由前端按「没有可用章纲」提示，不把模型原文抛给页面。
 */
function parseVolumeChapterDrafts(content: string): VolumeChapterDraft[] {
    const start = content.indexOf('[')
    const end = content.lastIndexOf(']')
    if (start < 0 || end <= start) {
        return []
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(content.slice(start, end + 1))
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    const drafts: VolumeChapterDraft[] = []
    for (const item of parsed.slice(0, MAX_VOLUME_CHAPTERS)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as { stage?: unknown; title?: unknown; summary?: unknown; beats?: unknown }
        const title = readText(record.title, MAX_VOLUME_CHAPTER_TITLE).replace(/^第\s*\d+\s*章\s*/u, '')
        if (title.length === 0) {
            continue
        }
        drafts.push({
            stage: readText(record.stage, MAX_VOLUME_CHAPTER_TITLE),
            title,
            summary: readText(record.summary, MAX_VOLUME_CHAPTER_SUMMARY),
            beats: readTextList(record.beats, 8, MAX_VOLUME_CHAPTER_SUMMARY),
        })
    }
    return drafts
}
