/**
 * 按提示词出图服务：接收前端拼装好的提示词与比例，经图像通道路由出图，落到作品统一目录 Images。
 * 复用约定：通道入口复用 ./ai/imageProvider，配额读写经 ../common/db/quotaRepository 并与旧入口共用同一额度，
 * 作品目录归一复用 ../common/projectPath，路径拼接一律经 ../common/storagePath。
 * 关键约束：文件名按新规范生成——角色图 portrait-{14 位时间戳}-{8 位角色标识}，
 * 其余 photo-{14 位时间戳}-{8 位随机串}；同秒同角色冲突时时间戳逐秒递增而非覆盖；
 * 每次成功出图落一份同名 sidecar（提示词与参数快照），供详情展示、复现与搜索；
 * 单一任务锁保证连点不会重复扣费，取消由 pressAi/generateImage/abort 触发。
 */
import * as vscode from 'vscode'
import { STYLE_HINTS } from './ai/portraitPrompt'
import { IMAGE_QUOTA_KEYS, IMAGES_DIR } from './constants'
import { readProjectDirPath } from './portraitService'
import type { ImageProviderRouter } from './ai/imageProvider'
import type { PressCoverStore } from './db/coverRepository'
import type { UsageRecorder } from '../ai/usageRecorder'
import type Database from 'better-sqlite3'
import {
    IMAGE_RATIO_SIZE,
    isPressImageId,
    type ImageGenerateKind,
    type ImageGenerateResult,
} from '../../shared/types/imagegen'
import { PORTRAIT_STYLES, type PortraitStyle } from '../../shared/types/press'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { consumeToday, readUsedToday } from '../common/db/quotaRepository'
import { logger } from '../common/logger'
import { readProjectSegments } from '../common/projectPath'
import { readText } from '../common/readInput'
import { buildStorageUri } from '../common/storagePath'

/** 提示词长度上限：远超正常拼装结果，超出视为异常请求 */
const MAX_PROMPT_LENGTH = 4000
/** 角色标识：与人物卡一致的 8 位数字 */
const CHARACTER_ID_PATTERN = /^\d{8}$/u
/** 随机段字母表 */
const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** 随机段长度 */
const RANDOM_LENGTH = 8
/** 同秒冲突时的最大顺延次数 */
const MAX_TIMESTAMP_SHIFT = 60

/** 出图入参：只保留落盘与通道需要的字段 */
interface NormalizedImageRequest {
    dirPath: string
    prompt: string
    kind: ImageGenerateKind
    characterId: string | null
    ratio: '1:1' | '3:4' | '4:3' | '16:9' | '9:16'
    style: PortraitStyle
    enhancedFrom: string | null
}

/** 本地时间戳：YYYYMMDDHHmmss，按文件名即可排序 */
function formatStamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(date.getFullYear()),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('')
}

/** 8 位字母数字随机串：仅用于普通图片的文件名去重 */
function randomSuffix(): string {
    let result = ''
    for (let index = 0; index < RANDOM_LENGTH; index += 1) {
        result += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)] ?? '0'
    }
    return result
}

/** 判断文件是否已存在：用于同秒冲突时顺延时间戳 */
async function isFileExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

/**
 * 生成不冲突的图片标识：角色图按「时间戳 + 角色标识」顺延秒数，普通图按随机串重试。
 * 关键约束：永不覆盖已有文件，冲突时换名而不是改写旧图。
 */
async function nextImageId(
    root: vscode.Uri,
    dirSegments: string[],
    kind: ImageGenerateKind,
    characterId: string | null,
    extension: string,
): Promise<string> {
    const base = new Date()
    for (let shift = 0; shift < MAX_TIMESTAMP_SHIFT; shift += 1) {
        const stamp = formatStamp(new Date(base.getTime() + shift * 1000))
        const id = kind === 'portrait' ? `portrait-${stamp}-${characterId ?? ''}` : `photo-${stamp}-${randomSuffix()}`
        if (!isPressImageId(id)) {
            continue
        }
        if (!(await isFileExisting(buildStorageUri(root, [...dirSegments, `${id}.${extension}`])))) {
            return id
        }
    }
    throw new Error('图片命名冲突过多，请稍后重试')
}

/** 入参收窄：目录、提示词、类别、角色、比例与画风全部在这一层校验 */
function normalizeGenerateRequest(payload: unknown): NormalizedImageRequest {
    const dirPath = readProjectDirPath(payload, 'pressAi/generateImage')
    const value = payload as {
        prompt?: unknown
        kind?: unknown
        characterId?: unknown
        ratio?: unknown
        style?: unknown
        enhancedFrom?: unknown
    }
    const prompt = readText(value.prompt, MAX_PROMPT_LENGTH)
    if (prompt.length === 0) {
        throw new Error('提示词不能为空')
    }
    const kind = value.kind
    if (kind !== 'cover' && kind !== 'portrait' && kind !== 'photo') {
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
        prompt,
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
        private readonly router: ImageProviderRouter,
        private readonly usageRecorder: UsageRecorder,
        private readonly store: PressCoverStore,
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
            const artifact = await this.router.generate({
                prompt: [request.prompt, STYLE_HINTS[request.style]].filter((part) => part.length > 0).join('\n\n'),
                size: IMAGE_RATIO_SIZE[request.ratio],
                signal: controller.signal,
            })
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
            await vscode.workspace.fs.createDirectory(buildStorageUri(root, dirSegments))
            const id = await nextImageId(root, dirSegments, request.kind, request.characterId, artifact.extension)
            const segments = [...dirSegments, `${id}.${artifact.extension}`]
            await vscode.workspace.fs.writeFile(buildStorageUri(root, segments), artifact.bytes)
            const createdAt = new Date().toISOString()
            await this.writeSidecar(buildStorageUri(root, dirSegments), id, {
                prompt: request.prompt,
                ratio: request.ratio,
                style: request.style,
                characterId: request.characterId,
                enhancedFrom: request.enhancedFrom,
                createdAt,
            })
            consumeToday(this.db, IMAGE_QUOTA_KEYS)
            const imagePath = segments.join('/')
            const coverSelectedId = request.kind === 'cover' ? id : null
            if (coverSelectedId !== null) {
                this.store.write(request.dirPath, imagePath)
            }
            logger.info(`出图完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                image: {
                    id,
                    kind: request.kind === 'portrait' ? 'portrait' : 'photo',
                    path: imagePath,
                    url: toWebviewUri(buildStorageUri(root, segments)),
                    createdAt,
                    characterId: request.characterId,
                },
                coverSelectedId,
                characterCoverId: null,
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

    /** 写侧车元数据：失败不影响主流程，仅导致该图失去提示词快照 */
    private async writeSidecar(
        dirUri: vscode.Uri,
        id: string,
        meta: {
            prompt: string
            ratio: string
            style: PortraitStyle
            characterId: string | null
            enhancedFrom: string | null
            createdAt: string
        },
    ): Promise<void> {
        try {
            const content = Buffer.from(JSON.stringify(meta), 'utf8')
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dirUri, `${id}.json`), content)
        } catch {
            logger.warn(`侧车元数据写入失败：${id}`)
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
