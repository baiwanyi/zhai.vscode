/**
 * 按提示词出图服务：接收前端拼装好的提示词与比例，经图像通道路由出图，落到存储根的 images/{YYYYMM}。
 * 复用约定：通道入口复用 ./ai/imageProvider，作品级参数经 ./imageSettingsService，
 * 配额读写经 ../common/db/quotaRepository，路径拼接一律经 ../common/storagePath；
 * 落盘命名与目录由 @modules/media/mediaNaming 统一产出，元数据经注入的媒体写入器入库，本模块不直接读写 media.db；
 * 词条只传标识，原文由 ./prompt/tagService 按标识回查后经 @shared/utils/promptTag 归一化；
 * 提示词拼装、限额与增强要求统一取 ./prompt（改提示词先看其 index.ts 的导航表）；
 * 规则文本由 ./prompt/ruleService 按标识读盘，参考图由 ./referenceImageService 校验并读成多模态输入。
 * 关键约束：文件名不再承载语义（14 位时间戳 + 6 位随机段），出处（作品 / 角色 / 条目）与出图参数全部进媒体索引，
 * 名称快照由前端随请求带入——宿主不重复解析人物卡与条目文档；
 * 单一任务锁防重复扣费，取消走 abort：产物到手后再确认一次中断标记，已取消的请求不落盘、不记用量、不扣配额。
 */
import * as vscode from 'vscode'
import { composePrompt, mergePromptTags } from '@modules/ai/finalPrompt'
import { PromptEnhanceService } from '@modules/ai/promptEnhance'
import type { AiProvider } from '@modules/ai/provider'
import { getSelectedCodebuddyModel } from '@modules/ai/providers/codebuddyModels'
import type { UsageRecorder } from '@modules/ai/usageRecorder'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { consumeToday, readUsedToday } from '@modules/common/db/quotaRepository'
import { logger } from '@modules/common/logger'
import { readText, readTextList } from '@modules/common/readInput'
import { buildStorageUri } from '@modules/common/storagePath'
import { nextMediaTarget, toMediaPath } from '@modules/media/mediaNaming'
import type { MediaRecord } from '@modules/media/mediaRepository'
import {
    DEFAULT_IMAGE_SETTINGS,
    IMAGE_RATIO_SIZE,
    type ImageGenerateKind,
    type ImageGenerateProgress,
    type ImageGenerateResult,
    type ImageSettings,
} from '@shared/types/imagegen'
import { PORTRAIT_STYLES, type PortraitStyle, type PressLoreKind } from '@shared/types/press'
import { IMAGE_QUOTA_KEYS } from './constants'
import { readProjectDirPath } from './portraitService'
import {
    MAX_CONTEXT_LENGTH,
    MAX_CONTEXTS,
    MAX_PROMPT_LENGTH,
    MAX_PROMPT_TAGS,
    MAX_RULE_NAME,
    MAX_RULES,
    MAX_TAG_ID_LENGTH,
    STYLE_HINTS,
} from './prompt'
import type { ImageGenerator } from './ai/imageProvider'
import type { ImageSettingsService } from './imageSettingsService'
import type { PromptRuleService, PromptTagService } from './prompt'
import type { ReferenceImageService } from './referenceImageService'
import type Database from 'better-sqlite3'

/** 提示词相关的长度与条数上限统一在 ./prompt/limits.ts，本文件不再自带数值 */
/** 参考图张数上限：与参考图服务的读取上限一致，超出部分丢弃 */
const MAX_REFERENCE_IMAGES = 3
/** 参考图路径长度上限：超长路径无法回查，直接截断后由服务跳过 */
const MAX_REFERENCE_PATH_LENGTH = 320
/** 归属标识：人物与资料条目共用同一规范，8 位数字 */
const NUMERIC_ID_PATTERN = /^\d{8}$/u
/** 名称快照长度上限：与媒体索引的短字段口径一致 */
const MAX_SHORT_TEXT = 64
/** 增强输出的 token 上限：图像描述比对话更短，压低上限避免模型扩写 */
const ENHANCE_MAX_TOKENS = 800

/** 出图入参：只保留落盘与通道需要的字段 */
interface NormalizedImageRequest {
    dirPath: string
    /** 用户正文：不含词条文本，词条在出图前按标识回查后前置合并 */
    prompt: string
    /** 词条标识：{分类}::{分组}::{名称}，出图前由词库服务换取原文 */
    promptTags: string[]
    /** 上下文段：正文以外的背景信息，由前端按芯片顺序展开 */
    contexts: string[]
    /** 规则标识：上下文的一部分，正文由宿主读盘后并入 */
    ruleIds: string[]
    /** 参考图路径：选择流程登记过的本地图片，出图前读成多模态输入 */
    references: string[]
    kind: ImageGenerateKind
    characterId: string | null
    /** 角色名快照：由前端从人物卡带入，写入媒体索引供删除角色后继续展示 */
    characterName: string | null
    loreKind: PressLoreKind | null
    loreId: string | null
    /** 条目名快照：同上，避免出处只有一个裸标识 */
    loreName: string | null
    ratio: '1:1' | '3:4' | '4:3' | '16:9' | '9:16'
    style: PortraitStyle
    enhancedFrom: string | null
}

/** 入参收窄：目录、提示词、上下文、规则、类别、角色、比例与画风全部在这一层校验 */
function normalizeGenerateRequest(payload: unknown): NormalizedImageRequest {
    const dirPath = readProjectDirPath(payload, 'pressAi/generateImage')
    const value = payload as {
        prompt?: unknown
        promptTags?: unknown
        contexts?: unknown
        promptRules?: unknown
        referenceImages?: unknown
        kind?: unknown
        characterId?: unknown
        characterName?: unknown
        loreKind?: unknown
        loreId?: unknown
        loreName?: unknown
        ratio?: unknown
        style?: unknown
        enhancedFrom?: unknown
    }
    const prompt = readText(value.prompt, MAX_PROMPT_LENGTH)
    // 词条只收标识：原文由 PromptTagService 按标识回查，顺序即芯片顺序，
    // 正文排在词条之后作为补充描述；词条被删除时由词库服务跳过，不阻断出图。
    const promptTags = readTextList(value.promptTags, MAX_PROMPT_TAGS, MAX_TAG_ID_LENGTH)
    // 上下文由「添加上下文」菜单产生：设定段是前端展开的文本，规则只传标识（文件名主干），
    // 规则正文在出图前由 PromptRuleService 读盘并入
    const contexts = readTextList(value.contexts, MAX_CONTEXTS, MAX_CONTEXT_LENGTH)
    const ruleIds = readTextList(value.promptRules, MAX_RULES, MAX_RULE_NAME)
    // 参考图只收路径，是否可用由 ReferenceImageService 按登记表判断
    const references = readTextList(value.referenceImages, MAX_REFERENCE_IMAGES, MAX_REFERENCE_PATH_LENGTH)
    // 正文、词条、上下文、规则与参考图都为空时才算空请求——只挂参考图同样可以出图
    if (
        prompt.length === 0 &&
        promptTags.length === 0 &&
        contexts.length === 0 &&
        ruleIds.length === 0 &&
        references.length === 0
    ) {
        throw new Error('提示词不能为空')
    }
    const kind = value.kind
    if (kind !== 'portrait' && kind !== 'lore' && kind !== 'photo') {
        throw new Error('图片类别非法')
    }
    const characterId = readText(value.characterId, 32)
    const loreId = readText(value.loreId, 32)
    const loreKindValue = value.loreKind
    const loreKind: PressLoreKind | null =
        loreKindValue === 'faction' || loreKindValue === 'place' || loreKindValue === 'item' ? loreKindValue : null
    if (kind === 'portrait') {
        if (!NUMERIC_ID_PATTERN.test(characterId)) {
            throw new Error('角色图缺少合法的角色标识')
        }
        if (loreId.length > 0 || loreKind !== null) {
            throw new Error('角色图不应携带条目归属')
        }
    } else if (kind === 'lore') {
        if (!NUMERIC_ID_PATTERN.test(loreId)) {
            throw new Error('条目图缺少合法的条目标识')
        }
        if (loreKind === null) {
            throw new Error('条目图缺少合法的条目分类')
        }
        if (characterId.length > 0) {
            throw new Error('条目图不应携带角色标识')
        }
    } else if (characterId.length > 0 || loreId.length > 0 || loreKind !== null) {
        throw new Error('普通图片不应携带归属标识')
    }
    const ratio = value.ratio
    if (ratio !== '1:1' && ratio !== '3:4' && ratio !== '4:3' && ratio !== '16:9' && ratio !== '9:16') {
        throw new Error('画面比例非法')
    }
    const style = PORTRAIT_STYLES.some((item) => item === value.style) ? (value.style as PortraitStyle) : 'auto'
    // 名称快照只作展示用途：长度按短字段收窄，缺失时写入 null，不影响出图
    const characterName = readText(value.characterName, MAX_SHORT_TEXT) || null
    const loreName = readText(value.loreName, MAX_SHORT_TEXT) || null
    return {
        dirPath,
        prompt,
        promptTags,
        contexts,
        ruleIds,
        references,
        kind,
        characterId: kind === 'portrait' ? characterId : null,
        characterName: kind === 'portrait' ? characterName : null,
        loreKind: kind === 'lore' ? loreKind : null,
        loreId: kind === 'lore' ? loreId : null,
        loreName: kind === 'lore' ? loreName : null,
        ratio,
        style,
        enhancedFrom: readText(value.enhancedFrom, MAX_PROMPT_LENGTH) || null,
    }
}

/** 出图入库回调：由装配处注入媒体索引写入器，避免出图模块直接依赖 media.db */
export type MediaRecorder = (record: MediaRecord) => void

export class ImageGenerateService {
    /** 进行中的生成请求：一次只允许一个，避免连点重复扣费 */
    private activeRequest: AbortController | null = null
    /** 提示词增强：与对话共用同一服务实现，只是口径与记账模块不同 */
    private readonly promptEnhance: PromptEnhanceService

    public constructor(
        private readonly db: Database.Database,
        private readonly router: ImageGenerator,
        private readonly usageRecorder: UsageRecorder,
        provider: AiProvider,
        private readonly settings: ImageSettingsService,
        private readonly rules: PromptRuleService,
        private readonly tags: PromptTagService,
        private readonly referenceImages: ReferenceImageService,
        private readonly recordMedia: MediaRecorder,
    ) {
        this.promptEnhance = new PromptEnhanceService(provider, usageRecorder)
    }

    /**
     * 按提示词生成一张图片并落盘。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async generate(
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
        onProgress?: (progress: ImageGenerateProgress) => void,
    ): Promise<ImageGenerateResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的图片请求，请等待完成')
        }
        const request = normalizeGenerateRequest(payload)
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        const startedAt = Date.now()
        logger.info(
            `出图开始：${request.dirPath}（${request.ratio}，${request.kind}，参考图 ${String(request.references.length)} 张）`,
        )
        try {
            const settings = await this.readSettings(request.dirPath)
            // 词条原文按标识回查：词条已被删除时由词库服务跳过，出图不因单条缺失而失败
            const tagTexts = await this.tags.readForPrompt(request.promptTags)
            // 词条与正文的合并口径统一由 mergePromptTags 提供，与下面的 enhance 共用同一份实现
            const mergedPrompt = mergePromptTags(tagTexts, request.prompt)
            // 规则正文按标识读盘：文件已被删除的规则静默跳过，出图不因单条规则缺失而失败
            const ruleTexts = await this.rules.readForPrompt(request.ruleIds)
            // 参考图按登记表校验后读成多模态输入；单张失效时跳过，不阻断出图
            const references = await this.referenceImages.readForPrompt(request.references)
            const artifact = await this.router.generate({
                prompt: composePrompt({
                    prompt: mergedPrompt,
                    contexts: request.contexts,
                    rules: ruleTexts,
                    suffix: settings.promptSuffix,
                    negative: settings.negative,
                    styleHint: STYLE_HINTS[request.style],
                }),
                size: IMAGE_RATIO_SIZE[request.ratio],
                references,
                signal: controller.signal,
                // 进度是旁路：通道回调异常不得影响出图，故只做一次转发
                onProgress,
            })
            // 产物到手后再确认一次取消：落盘、扣配额、写封面都是不可撤回的副作用，
            // 用户点过停止就不该发生，否则会出现「界面已复位、图却凭空多出来」的情况。
            // provider 内部通常已因 abort 抛错，这一条兜住「刚好在回包前后点停止」的竞态。
            if (controller.signal.aborted) {
                logger.info(`出图取消：产物已丢弃，耗时 ${Date.now() - startedAt}ms`)
                throw new Error('出图已取消')
            }
            this.usageRecorder.record({
                module: 'image',
                model: getSelectedCodebuddyModel(),
                usage: artifact.usage ?? null,
                meta: artifact.meta ?? null,
                prompt: mergedPrompt,
                startedAt: artifact.startedAt ?? startedAt,
            })
            const root = resolveStorageRoot()
            const projectName = request.dirPath.split('/')[1] ?? request.dirPath
            // 目录与文件名由同一次计算产出：跨秒或跨月时不会出现「目录 202610、文件名 202611」的错位
            const target = await nextMediaTarget(root, artifact.extension)
            await vscode.workspace.fs.createDirectory(target.dirUri)
            const mediaPath = toMediaPath(target.monthDir, target.id, artifact.extension)
            await vscode.workspace.fs.writeFile(buildStorageUri(root, mediaPath.split('/')), artifact.bytes)
            const createdAt = new Date().toISOString()
            const ext = artifact.extension.replace(/^\./u, '').toLowerCase()
            this.recordMedia({
                id: target.id,
                path: mediaPath,
                ext,
                byteSize: artifact.bytes.byteLength,
                month: target.month,
                createdAt,
                scope: 'press',
                origin: 'generate',
                kind: request.kind,
                pressPath: request.dirPath,
                pressName: projectName,
                characterId: request.characterId,
                characterName: request.characterName,
                loreKind: request.loreKind,
                loreId: request.loreId,
                loreName: request.loreName,
                prompt: mergedPrompt,
                ratio: request.ratio,
                style: request.style,
                enhancedFrom: request.enhancedFrom,
            })
            consumeToday(this.db, IMAGE_QUOTA_KEYS)
            logger.info(`出图完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                image: {
                    id: target.id,
                    path: mediaPath,
                    url: toWebviewUri(buildStorageUri(root, mediaPath.split('/'))),
                    ext,
                    byteSize: artifact.bytes.byteLength,
                    month: target.month,
                    createdAt,
                    scope: 'press',
                    origin: 'generate',
                    kind: request.kind,
                    pressPath: request.dirPath,
                    pressName: projectName,
                    characterId: request.characterId,
                    characterName: request.characterName,
                    loreKind: request.loreKind,
                    loreId: request.loreId,
                    loreName: request.loreName,
                    usageCount: 0,
                    missing: false,
                    prompt: mergedPrompt,
                    ratio: request.ratio,
                    style: request.style,
                    enhancedFrom: request.enhancedFrom,
                },
            }
        } catch (error) {
            logger.error(`出图失败：耗时 ${Date.now() - startedAt}ms`, error)
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /** 取消进行中的生成：无进行中请求时返回 false，由前端决定是否提示 */
    public abort(): { aborted: boolean } {
        if (!this.activeRequest) {
            return { aborted: false }
        }
        this.activeRequest.abort()
        return { aborted: true }
    }

    /**
     * 增强提示词：用文本模型把用户输入改写成更具体的画面描述，不落盘、不计图片配额。
     * 复用约定：模型调用、超时与记账统一由 modules/ai/promptEnhance 的 PromptEnhanceService 承担，
     * 图像口径由该模块的 ENHANCE_SYSTEM_PROMPTS.image 提供；词条原文按标识读盘后经 mergePromptTags 与正文合并，
     * 与出图共用同一份合并口径，改写结果因此承接词条描述。
     * 关键约束：只接收输入框正文与词条标识，不读作品设定与规则——设定由前端在发送时另行拼装，避免模型复述设定原文；
     * 增强结果已含词条描述，前端需据此摘掉词条芯片，否则回填后发送会被二次合并；
     * 失败或超时向调用方抛出，由前端保留原文并提示，不静默替换用户输入。
     */
    public async enhance(payload: unknown): Promise<{ text: string }> {
        const record = payload as { text?: unknown; promptTags?: unknown } | null
        const source = readText(record?.text, MAX_PROMPT_LENGTH)
        // 词条只收标识：原文由词库服务回查，已被删除的词条跳过，不阻断改写
        const promptTags = readTextList(record?.promptTags, MAX_PROMPT_TAGS, MAX_TAG_ID_LENGTH)
        if (source.length === 0 && promptTags.length === 0) {
            throw new Error('请先输入提示词')
        }
        const tagTexts = await this.tags.readForPrompt(promptTags)
        const mergedPrompt = mergePromptTags(tagTexts, source)
        const startedAt = Date.now()
        const text = await this.promptEnhance.enhance({
            text: mergedPrompt,
            scene: 'image',
            maxTokens: ENHANCE_MAX_TOKENS,
            maxInputLength: MAX_PROMPT_LENGTH,
            maxOutputLength: MAX_PROMPT_LENGTH,
            module: 'image',
        })
        logger.info(`提示词增强完成：耗时 ${Date.now() - startedAt}ms`)
        return { text }
    }

    /** 读取作品级参数：失败回落默认值，参数问题不应阻断出图 */
    private async readSettings(dirPath: string): Promise<ImageSettings> {
        try {
            const result = await this.settings.get({ dirPath })
            return result.settings
        } catch {
            logger.warn(`作品生图参数读取失败，已回落默认值：${dirPath}`)
            return DEFAULT_IMAGE_SETTINGS
        }
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制（与旧入口共用同一额度） */
    private assertQuota(): void {
        const limit = getZhaiConfig().imageDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, IMAGE_QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日图片生成次数已用完（${used} / ${limit}），可明日再试或调高 zhai.image.dailyLimit`)
        }
    }
}
