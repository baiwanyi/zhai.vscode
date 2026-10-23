/**
 * 写作管理 AI 服务：校验密钥与每日配额后执行一次性生成，当前承载人物外貌。
 * 复用约定：模型通道经注入的 AI 通道（../ai/provider）驱动 ./ai/aiAppearanceGenerator，提示词与清洗复用 ./ai/appearancePrompt；
 * 配额经 ./db/quotaRepository 落在 press.db 的 meta 表，与角色设定图各用一组键。
 * 关键约束：入参一律先经 normalizeAppearanceRequest 收窄（长度、条数、类型），异常载荷不进入模型调用；
 * 同一时刻只允许一个生成请求，取消由 pressAi/aiAppearance/abort 触发；限额小于等于 0 视为不限制。
 */
import { generateAppearanceWithAi } from './ai/aiAppearanceGenerator'
import { buildAppearanceMessages, sanitizeAppearance } from './ai/appearancePrompt'
import { consumeToday, readUsedToday } from './db/quotaRepository'
import type { QuotaKeys } from './db/quotaRepository'
import type { CharacterAppearanceRequest, CharacterAppearanceResult } from '../../shared/types/press'
import type { AiProvider } from '../ai/provider'
import type { UsageRecorder } from '../ai/usageRecorder'
import type Database from 'better-sqlite3'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { summarizeMessages } from '../ai/usageRecorder'
import { getZhaiConfig } from '../common/config'

/** 外貌生成的配额键（press.db 的 meta 表） */
const QUOTA_KEYS: QuotaKeys = { dateKey: 'press_ai_date', countKey: 'press_ai_count' }
/** 单字段长度上限：人物名、身份等短字段 */
const MAX_SHORT_TEXT = 64
/** 单字段长度上限：欲望、弱点、能力等描述字段 */
const MAX_LONG_TEXT = 200
/** 性格标签条数与单条长度 */
const MAX_TRAIT_COUNT = 8
const MAX_TRAIT_LENGTH = 16
/** 题材条数与单条长度 */
const MAX_GENRE_COUNT = 6
const MAX_GENRE_LENGTH = 16

export class PressAiService {
    /** 进行中的生成请求：用于 press/aiAppearance/abort 取消 */
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
        if (this.activeRequest) {
            throw new Error('已有生成中的外貌请求，请等待完成或先取消')
        }
        const request = normalizeAppearanceRequest(payload)
        const status = await this.provider.checkReady()
        if (!status.ready) {
            throw new Error(status.reason ?? 'AI 通道未就绪，请先在插件设置中完成配置')
        }
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        try {
            const result = await generateAppearanceWithAi({
                provider: this.provider,
                model: getSelectedCodebuddyModel(),
                request,
                signal: controller.signal,
            })
            const content = sanitizeAppearance(result.content)
            if (content.length === 0) {
                throw new Error('AI 未返回可用的外貌描写，请重试或手动填写')
            }
            consumeToday(this.db, QUOTA_KEYS)
            this.usageRecorder.record({
                module: 'appearance',
                model: getSelectedCodebuddyModel(),
                usage: result.usage,
                prompt: summarizeMessages(buildAppearanceMessages(request)),
            })
            return { content }
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error('AI 外貌生成已取消或超时，请重试', { cause: error })
            }
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /** 取消进行中的生成 */
    public abortAppearance(): { aborted: boolean } {
        if (!this.activeRequest) {
            return { aborted: false }
        }
        this.activeRequest.abort()
        return { aborted: true }
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制 */
    private assertQuota(): void {
        const limit = getZhaiConfig().pressAiDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日 AI 外貌生成次数已用完（${used} / ${limit}），可手动填写或明日再试`)
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

/** 读取字符串字段：非字符串一律回落空串 */
export function readText(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

/** 读取字符串数组：过滤非字符串、去重并按上限截断 */
export function readTextList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    const items: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') {
            continue
        }
        const text = item.trim().slice(0, maxLength)
        if (text.length === 0 || items.includes(text)) {
            continue
        }
        items.push(text)
        if (items.length >= maxItems) {
            break
        }
    }
    return items
}
