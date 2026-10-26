/**
 * 按提示词出图服务：接收前端拼装好的提示词与比例，经图像通道路由出图，落到作品统一目录 Images。
 * 复用约定：通道入口复用 ./ai/imageProvider，作品级参数经 ./imageSettingsService，
 * 配额读写经 ../common/db/quotaRepository 并与旧入口共用同一额度，路径拼接一律经 ../common/storagePath；
 * 词条文本由前端传入的上游原文经 @shared/utils/promptTag 归一化换取，与面板展示共用同一套写法；
 * 规则文本由 ./promptRuleService 按标识读盘，前端只传标识，规则改文不必重新进页面。
 * 关键约束：文件名按新规范生成——角色图 portrait-{14 位时间戳}-{8 位角色标识}，
 * 其余 photo-{14 位时间戳}-{8 位随机串}；同秒同角色冲突时时间戳逐秒递增而非覆盖；
 * 词条在前、正文在后合并成一段提示词，词条为空数组时行为与纯正文完全一致；
 * 规则段排在正文之后、作品补充之前，规则缺失只跳过，不阻断出图；
 * 作品级 promptSuffix / negative 在出图前叠加，读取失败回落默认且不阻断出图；
 * 每次成功出图落一份同名 sidecar；单一任务锁防重复扣费，取消走 abort——
 * 产物到手后还会再确认一次中断标记，已取消的请求不落盘、不记用量、不扣配额。
 */
import * as vscode from 'vscode'
import type { AiProvider } from '@modules/ai/provider'
import { getSelectedCodebuddyModel } from '@modules/ai/providers/codebuddyModels'
import type { UsageRecorder } from '@modules/ai/usageRecorder'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { consumeToday, readUsedToday } from '@modules/common/db/quotaRepository'
import { logger } from '@modules/common/logger'
import { readProjectSegments } from '@modules/common/projectPath'
import { readText, readTextList } from '@modules/common/readInput'
import { buildStorageUri } from '@modules/common/storagePath'
import {
    DEFAULT_IMAGE_SETTINGS,
    IMAGE_RATIO_SIZE,
    type ImageGenerateKind,
    type ImageGenerateResult,
    type ImageSettings,
} from '@shared/types/imagegen'
import { PORTRAIT_STYLES, type PortraitStyle } from '@shared/types/press'
import { normalizePromptTag } from '@shared/utils/promptTag'
import { IMAGE_QUOTA_KEYS, IMAGES_DIR } from './constants'
import { nextImageId } from './imageNaming'
import { writeSidecarOf } from './imageSidecar'
import { readProjectDirPath } from './portraitService'
import { composeImagePrompt } from './promptCompose'
import type { ImageGenerator } from './ai/imageProvider'
import type { ImageSettingsService } from './imageSettingsService'
import type { PromptRuleService } from './promptRuleService'
import type Database from 'better-sqlite3'

/** 提示词长度上限：远超正常拼装结果，超出视为异常请求 */
const MAX_PROMPT_LENGTH = 4000
/** 词条条数上限：与前端可选芯片数量同量级，超出视为异常请求 */
const MAX_PROMPT_TAGS = 20
/** 单词条原文长度上限 */
const MAX_PROMPT_TAG_LENGTH = 512
/** 规则条数上限：与前端可选芯片数量同量级，超出部分由宿主丢弃 */
const MAX_PROMPT_RULES = 5
/** 单条规则标识长度上限：与规则名上限一致 */
const MAX_PROMPT_RULE_ID_LENGTH = 40
/** 角色标识：与人物卡一致的 8 位数字 */
const CHARACTER_ID_PATTERN = /^\d{8}$/u
/** 提示词增强的超时：文本改写足够快，超过即视为失败并由前端保留原文 */
const ENHANCE_TIMEOUT_MS = 30_000
/** 增强输出的 token 上限 */
const ENHANCE_MAX_TOKENS = 800

/** 出图入参：只保留落盘与通道需要的字段 */
interface NormalizedImageRequest {
    dirPath: string
    /** 已并入词条文本的完整正文 */
    prompt: string
    /** 规则标识：正文以外的约束，由宿主读盘后并入 */
    ruleIds: string[]
    kind: ImageGenerateKind
    characterId: string | null
    ratio: '1:1' | '3:4' | '4:3' | '16:9' | '9:16'
    style: PortraitStyle
    enhancedFrom: string | null
}

/** 入参收窄：目录、提示词、规则、类别、角色、比例与画风全部在这一层校验 */
function normalizeGenerateRequest(payload: unknown): NormalizedImageRequest {
    const dirPath = readProjectDirPath(payload, 'pressAi/generateImage')
    const value = payload as {
        prompt?: unknown
        promptTags?: unknown
        promptRules?: unknown
        kind?: unknown
        characterId?: unknown
        ratio?: unknown
        style?: unknown
        enhancedFrom?: unknown
    }
    const prompt = readText(value.prompt, MAX_PROMPT_LENGTH)
    // 词条芯片只带上游原文，文本在这里换取：顺序即芯片顺序，正文排在词条之后作为补充描述。
    // 词条未知或书写不合法时归一化为空串并被跳过，不阻断出图——正文仍然可用。
    const promptTags = readTextList(value.promptTags, MAX_PROMPT_TAGS, MAX_PROMPT_TAG_LENGTH)
    const tagText = promptTags.map((tag) => normalizePromptTag(tag)).filter((text) => text.length > 0)
    const mergedPrompt = [...tagText, prompt]
        .filter((part) => part.length > 0)
        .join(', ')
        .slice(0, MAX_PROMPT_LENGTH)
    // 规则只传标识（文件名主干），正文在出图前由 PromptRuleService 读盘并入；
    // 正文与规则都为空时才算空提示词——只挂规则也能出图
    const ruleIds = readTextList(value.promptRules, MAX_PROMPT_RULES, MAX_PROMPT_RULE_ID_LENGTH)
    if (mergedPrompt.length === 0 && ruleIds.length === 0) {
        throw new Error('提示词不能为空')
    }
    const kind = value.kind
    if (kind !== 'portrait' && kind !== 'photo') {
        throw new Error('图片类别非法')
    }
    const characterId = readText(value.characterId, 32)
    if (kind === 'portrait') {
        if (!CHARACTER_ID_PATTERN.test(characterId)) {
            throw new Error('角色图缺少合法的角色标识')
        }
    } else if (characterId.length > 0) {
        throw new Error('非角色图不应携带角色标识')
    }
    const ratio = value.ratio
    if (ratio !== '1:1' && ratio !== '3:4' && ratio !== '4:3' && ratio !== '16:9' && ratio !== '9:16') {
        throw new Error('画面比例非法')
    }
    const style = PORTRAIT_STYLES.some((item) => item === value.style) ? (value.style as PortraitStyle) : 'auto'
    return {
        dirPath,
        prompt: mergedPrompt,
        ruleIds,
        kind,
        characterId: kind === 'portrait' ? characterId : null,
        ratio,
        style,
        enhancedFrom: readText(value.enhancedFrom, MAX_PROMPT_LENGTH) || null,
    }
}

export class ImageGenerateService {
    /** 进行中的生成请求：一次只允许一个，避免连点重复扣费 */
    private activeRequest: AbortController | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly router: ImageGenerator,
        private readonly usageRecorder: UsageRecorder,
        private readonly provider: AiProvider,
        private readonly settings: ImageSettingsService,
        private readonly rules: PromptRuleService,
    ) {}

    /**
     * 按提示词生成一张图片并落盘。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async generate(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<ImageGenerateResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的图片请求，请等待完成')
        }
        const request = normalizeGenerateRequest(payload)
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        const startedAt = Date.now()
        logger.info(`出图开始：${request.dirPath}（${request.ratio}，${request.kind}）`)
        try {
            const settings = await this.readSettings(request.dirPath)
            // 规则正文按标识读盘：文件已被删除的规则静默跳过，出图不因单条规则缺失而失败
            const ruleTexts = await this.rules.readForPrompt(request.ruleIds)
            const artifact = await this.router.generate({
                prompt: composeImagePrompt(request.prompt, settings, request.style, ruleTexts),
                size: IMAGE_RATIO_SIZE[request.ratio],
                signal: controller.signal,
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
                prompt: request.prompt,
                startedAt: artifact.startedAt ?? startedAt,
            })
            const root = resolveStorageRoot()
            const dirSegments = [...readProjectSegments(request.dirPath), IMAGES_DIR]
            const dirUri = buildStorageUri(root, dirSegments)
            await vscode.workspace.fs.createDirectory(dirUri)
            const id = await nextImageId(dirUri, request.kind, request.characterId, artifact.extension)
            const segments = [...dirSegments, `${id}.${artifact.extension}`]
            await vscode.workspace.fs.writeFile(buildStorageUri(root, segments), artifact.bytes)
            const createdAt = new Date().toISOString()
            await writeSidecarOf(dirUri, id, {
                prompt: request.prompt,
                ratio: request.ratio,
                style: request.style,
                characterId: request.characterId,
                enhancedFrom: request.enhancedFrom,
                createdAt,
            })
            consumeToday(this.db, IMAGE_QUOTA_KEYS)
            const imagePath = segments.join('/')
            logger.info(`出图完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                image: {
                    id,
                    kind: request.kind,
                    path: imagePath,
                    url: toWebviewUri(buildStorageUri(root, segments)),
                    createdAt,
                    characterId: request.characterId,
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
     * 关键约束：只接收输入框正文，不读作品设定——设定由前端在发送时另行拼装，避免模型复述设定原文；
     * 失败或超时向调用方抛出，由前端保留原文并提示，不静默替换用户输入。
     */
    public async enhance(payload: unknown): Promise<{ text: string }> {
        const record = payload as { text?: unknown } | null
        const source = readText(record?.text, MAX_PROMPT_LENGTH)
        if (source.length === 0) {
            throw new Error('请先输入提示词')
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS)
        const startedAt = Date.now()
        let content = ''
        try {
            const stream = this.provider.stream({
                model: getSelectedCodebuddyModel(),
                maxTokens: ENHANCE_MAX_TOKENS,
                messages: [
                    {
                        role: 'system',
                        content:
                            '你是图像提示词编辑。把用户输入改写成更具体的画面描述：补足人物姿态、服装材质、场景层次、光线方向与镜头距离；保持原意与语言，不要添加解释、标题或列表，只输出一段连续的描述。',
                    },
                    { role: 'user', content: source },
                ],
                signal: controller.signal,
            })
            for await (const chunk of stream) {
                content += chunk.content
            }
        } finally {
            clearTimeout(timer)
        }
        const enhanced = content.trim()
        if (enhanced.length === 0) {
            throw new Error('增强失败：模型没有返回内容')
        }
        this.usageRecorder.record({
            module: 'image',
            model: getSelectedCodebuddyModel(),
            usage: null,
            meta: null,
            prompt: source,
            startedAt,
        })
        logger.info(`提示词增强完成：耗时 ${Date.now() - startedAt}ms`)
        return { text: enhanced.slice(0, MAX_PROMPT_LENGTH) }
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
