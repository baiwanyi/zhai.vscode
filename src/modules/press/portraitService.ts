/**
 * 角色设定图服务：校验配额后经图像通道路由出图，按人物建目录落盘，并返回 webview 可用 URL。
 * 复用约定：图像通道经 ./ai/imageProvider 的入口（唯一实现为 CodeBuddy 的 ImageGen），提示词复用 ./ai/portraitPrompt，
 * 配额复用 ./db/quotaRepository，路径一律经 common/storagePath 做白名单校验；URL 转换由调用方注入。
 * 关键约束：图片落在 press/_portraits/{characterId}/ 下，人物标识须匹配安全字符集；
 * 删除只接受 press/_portraits 下的四段相对路径，优先走回收站；同一时刻只允许一个生成请求。
 */
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { buildPortraitPrompt } from './ai/portraitPrompt'
import { consumeToday, readUsedToday } from './db/quotaRepository'
import { readText, readTextList } from './pressAiService'
import { PRESS_MODULE_DIR } from './projectFactory'
import type { ImageProviderRouter } from './ai/imageProvider'
import type { QuotaKeys } from './db/quotaRepository'
import type { PortraitGenerateRequest, PortraitGenerateResult, PortraitStyle } from '../../shared/types/press'
import type Database from 'better-sqlite3'
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLES } from '../../shared/types/press'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri, toSafeSegments } from '../common/storagePath'

/** 角色设定图的二级目录名，下划线前缀避免与作品名冲突，且不参与索引 */
const PORTRAIT_DIR = '_portraits'
/** 角色设定图的配额键（press.db 的 meta 表） */
const QUOTA_KEYS: QuotaKeys = { dateKey: 'press_image_date', countKey: 'press_image_count' }
/** 人物标识白名单：只允许字母、数字、下划线与短横线，避免路径穿越 */
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/
/** 短字段长度上限 */
const MAX_SHORT_TEXT = 64
/** 长字段长度上限 */
const MAX_LONG_TEXT = 400
/** 相对路径长度上限 */
const MAX_PATH_LENGTH = 256

export class PortraitService {
    /** 进行中的生成请求：用于 pressAi/aiPortrait/abort 取消 */
    private activeRequest: AbortController | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly router: ImageProviderRouter,
    ) {}

    /**
     * 生成一张角色设定图并落盘。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async generate(
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PortraitGenerateResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的角色卡请求，请等待完成或先取消')
        }
        const request = normalizePortraitRequest(payload)
        const config = getZhaiConfig()
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        const startedAt = Date.now()
        logger.info(`角色卡生成开始：${request.name}（${config.imageSize}）`)
        try {
            const artifact = await this.router.generate({
                prompt: buildPortraitPrompt(request),
                size: config.imageSize,
                signal: controller.signal,
            })
            logger.info('角色卡通道：codebuddy')
            const id = `portrait-${randomUUID()}`
            const extension = artifact.extension
            const segments = [PRESS_MODULE_DIR, PORTRAIT_DIR, request.characterId, `${id}.${extension}`]
            const root = resolveStorageRoot()
            await vscode.workspace.fs.createDirectory(buildStorageUri(root, segments.slice(0, -1)))
            const target = buildStorageUri(root, segments)
            await vscode.workspace.fs.writeFile(target, artifact.bytes)
            consumeToday(this.db, QUOTA_KEYS)
            logger.info(`角色卡生成完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                portrait: {
                    id,
                    path: segments.join('/'),
                    url: toWebviewUri(target),
                    createdAt: new Date().toISOString(),
                },
            }
        } catch (error) {
            // 取消与超时的文案由执行器给出，此处只补日志便于排查服务商耗时
            logger.error(`角色卡生成失败：耗时 ${Date.now() - startedAt}ms`, error)
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /** 取消进行中的生成 */
    public abort(): { aborted: boolean } {
        if (!this.activeRequest) {
            return { aborted: false }
        }
        this.activeRequest.abort()
        return { aborted: true }
    }

    /** 删除一张已落盘的角色设定图：优先回收站，不支持时退化为直接删除 */
    public async remove(payload: unknown): Promise<{ removed: boolean }> {
        const path = readPortraitPath(payload)
        const segments = toSafeSegments(path, '角色卡')
        if (segments.length !== 4 || segments[0] !== PRESS_MODULE_DIR || segments[1] !== PORTRAIT_DIR) {
            throw new Error(`角色卡路径非法：${path}`)
        }
        const target = buildStorageUri(resolveStorageRoot(), segments)
        try {
            await vscode.workspace.fs.delete(target, { useTrash: true })
            return { removed: true }
        } catch {
            try {
                await vscode.workspace.fs.delete(target, { useTrash: false })
                return { removed: true }
            } catch {
                return { removed: false }
            }
        }
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制 */
    private assertQuota(): void {
        const limit = getZhaiConfig().imageDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日角色卡生成次数已用完（${used} / ${limit}），可明日再试或调高 zhai.image.dailyLimit`)
        }
    }
}

/** 入参收窄：人物标识走白名单，其余字段逐个截断，姓名为空直接拒绝 */
function normalizePortraitRequest(payload: unknown): PortraitGenerateRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/generatePortrait 缺少参数')
    }
    const value = payload as {
        characterId?: unknown
        name?: unknown
        role?: unknown
        gender?: unknown
        age?: unknown
        identity?: unknown
        appearance?: unknown
        traits?: unknown
        desire?: unknown
        weakness?: unknown
        ability?: unknown
        era?: unknown
        genres?: unknown
        tone?: unknown
        style?: unknown
    }
    const characterId = readText(value.characterId, MAX_SHORT_TEXT)
    if (!CHARACTER_ID_PATTERN.test(characterId)) {
        throw new Error('人物标识非法，无法建立角色卡目录')
    }
    const request: PortraitGenerateRequest = {
        characterId,
        name: readText(value.name, MAX_SHORT_TEXT),
        role: readText(value.role, MAX_SHORT_TEXT),
        gender: readText(value.gender, MAX_SHORT_TEXT),
        age: readText(value.age, MAX_SHORT_TEXT),
        identity: readText(value.identity, MAX_SHORT_TEXT),
        appearance: readText(value.appearance, MAX_LONG_TEXT),
        traits: readTextList(value.traits, 8, 16),
        desire: readText(value.desire, MAX_LONG_TEXT),
        weakness: readText(value.weakness, MAX_LONG_TEXT),
        ability: readText(value.ability, MAX_LONG_TEXT),
        era: readText(value.era, MAX_SHORT_TEXT),
        genres: readTextList(value.genres, 6, 16),
        tone: readText(value.tone, MAX_SHORT_TEXT),
        style: readStyle(value.style),
    }
    if (request.name.length === 0) {
        throw new Error('缺少人物姓名，无法生成角色卡')
    }
    return request
}

/** 读取画风：只接受白名单内的值，其余一律回落默认风格 */
function readStyle(value: unknown): PortraitStyle {
    if (typeof value !== 'string') {
        return DEFAULT_PORTRAIT_STYLE
    }
    return PORTRAIT_STYLES.find((item) => item === value) ?? DEFAULT_PORTRAIT_STYLE
}

/** 读取删除请求里的相对路径 */
function readPortraitPath(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/deletePortrait 缺少参数')
    }
    const path = readText((payload as { path?: unknown }).path, MAX_PATH_LENGTH)
    if (path.length === 0) {
        throw new Error('缺少角色卡路径')
    }
    return path
}
