/**
 * CodeBuddy 图像通道：经 Agent SDK 调用 CLI 内置的 ImageGen 工具出图。
 * 复用约定：提示词与尺寸由调用方给出，本层只负责拼指令、驱动工具、把产物归一为字节；
 * 凭证优先取 SecretStorage 的 CodeBuddy API Key，缺省沿用 CLI 登录态。
 * 关键约束：只放行 ImageGen 且限制单轮；产物形态不确定（image block / 文件路径 / URL），
 * 按「image block → 文本中的路径 → 文本中的 URL」顺序解析，均失败时明确报错而不是返回空图。
 */
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { query } from '@tencent-ai/agent-sdk'
import type { ImageGenerateOptions, ImageGenerateResult, ImageProvider, ImageProviderId } from './imageProvider'
import type { SecretsService } from '../../common/secrets'
import type { ContentBlock } from '@tencent-ai/agent-sdk'
import { getZhaiConfig } from '../../common/config'

/** 单张图片体积上限，与直连通道保持一致 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
/** 文本中可能出现的图片路径：Windows 盘符或 POSIX 绝对路径 */
const IMAGE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/)[^\s"'<>()]+\.(?:png|jpe?g|webp)/i
/** 文本中可能出现的图片地址 */
const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'<>()]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>()]*)?/i

/** 拼出交给模型的出图指令：要求只调用工具并回报路径，避免它继续解释画面 */
function buildInstruction(options: ImageGenerateOptions): string {
    return [
        '请使用 ImageGen 工具生成一张图片，不要用文字描述代替出图。',
        `画面要求：${options.prompt}`,
        `尺寸：${options.size}`,
        '完成后只回复图片的本地绝对路径或可访问链接，不要附加其他说明。',
    ].join('\n')
}

/** 把 SDK 的原始错误转成可执行提示 */
function toReadableError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (/authentication required|please (use|run) \/login/i.test(message)) {
        return new Error('尚未登录 CodeBuddy：请在命令面板执行「宅写作：登录 CodeBuddy」后重试', { cause: error })
    }
    return error instanceof Error ? error : new Error(message)
}

/** 从路径或响应头推断扩展名，未知一律按 png 处理 */
function extensionOf(value: string): 'png' | 'jpg' | 'webp' {
    const lower = value.toLowerCase()
    if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('image/jpeg')) {
        return 'jpg'
    }
    if (lower.includes('.webp') || lower.includes('image/webp')) {
        return 'webp'
    }
    return 'png'
}

/** 校验并归一图片体积 */
function toResult(bytes: Uint8Array, extension: 'png' | 'jpg' | 'webp'): ImageGenerateResult {
    if (bytes.byteLength === 0) {
        throw new Error('CodeBuddy 返回了空图片')
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('图片体积超过上限，已放弃保存')
    }
    return { bytes, extension }
}

export class CodeBuddyImageProvider implements ImageProvider {
    public readonly id: ImageProviderId = 'codebuddy'

    public constructor(private readonly secrets: SecretsService) {}

    /**
     * 能力探测：起一次单轮查询，读 system.init 的工具列表里是否含 ImageGen。
     * 拿到 init 即中断，尽量缩短子进程存活时间；探测失败一律视为不可用。
     */
    public async isAvailable(): Promise<boolean> {
        const controller = new AbortController()
        const session = query({
            prompt: 'ok',
            options: {
                maxTurns: 1,
                includePartialMessages: false,
                cwd: tmpdir(),
                abortController: controller,
            },
        })
        try {
            for await (const message of session) {
                if (message.type === 'system' && message.subtype === 'init') {
                    return message.tools.includes('ImageGen')
                }
            }
            return false
        } catch {
            return false
        } finally {
            controller.abort()
        }
    }

    public async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
        const cfg = getZhaiConfig()
        const apiKey = await this.secrets.get('codebuddyApiKey')
        const controller = new AbortController()
        const forwardAbort = (): void => controller.abort()
        if (options.signal.aborted) {
            controller.abort()
        } else {
            options.signal.addEventListener('abort', forwardAbort, { once: true })
        }
        const model = cfg.imageCodebuddyModel.trim()
        const session = query({
            prompt: buildInstruction(options),
            options: {
                // 仅放行出图工具，避免模型顺带读写工作区
                tools: ['ImageGen'],
                maxTurns: 1,
                permissionMode: 'default',
                includePartialMessages: false,
                cwd: tmpdir(),
                model: model.length > 0 ? model : undefined,
                abortController: controller,
                env: apiKey ? { CODEBUDDY_API_KEY: apiKey } : undefined,
            },
        })
        const blocks: ContentBlock[] = []
        let failure: string | null = null
        try {
            for await (const message of session) {
                if (message.type === 'assistant') {
                    blocks.push(...message.message.content)
                    continue
                }
                if (message.type === 'user') {
                    const { content } = message.message
                    if (Array.isArray(content)) {
                        blocks.push(...content)
                    } else {
                        blocks.push({ type: 'text', text: content })
                    }
                    continue
                }
                if (message.type === 'result' && message.subtype !== 'success') {
                    failure = message.errors?.join('；') ?? message.subtype
                }
            }
        } catch (error) {
            throw toReadableError(error)
        } finally {
            options.signal.removeEventListener('abort', forwardAbort)
            if (!controller.signal.aborted) {
                controller.abort()
            }
        }
        if (failure !== null) {
            throw new Error(`CodeBuddy 出图失败：${failure}`)
        }
        const artifact = await this.readArtifact(blocks)
        if (artifact === null) {
            throw new Error('CodeBuddy 未返回可直接读取的图片，请检查该通道的出图能力或改用直连服务')
        }
        return artifact
    }

    /** 按 image block → 文本中的路径 → 文本中的 URL 顺序解析产物 */
    private async readArtifact(blocks: ContentBlock[]): Promise<ImageGenerateResult | null> {
        for (const block of blocks) {
            if (block.type !== 'image') {
                continue
            }
            if (block.source.type === 'base64') {
                return toResult(new Uint8Array(Buffer.from(block.source.data, 'base64')), extensionOf(block.source.media_type))
            }
            const downloaded = await this.download(block.source.url)
            if (downloaded !== null) {
                return downloaded
            }
        }
        const text = collectText(blocks)
        const path = text.match(IMAGE_PATH_PATTERN)?.[0]
        if (path !== undefined) {
            const file = await this.readFile(path)
            if (file !== null) {
                return file
            }
        }
        const url = text.match(IMAGE_URL_PATTERN)?.[0]
        if (url !== undefined) {
            return this.download(url)
        }
        return null
    }

    private async readFile(path: string): Promise<ImageGenerateResult | null> {
        try {
            const bytes = new Uint8Array(await readFile(path))
            return toResult(bytes, extensionOf(path))
        } catch {
            return null
        }
    }

    private async download(url: string): Promise<ImageGenerateResult | null> {
        try {
            const response = await fetch(url)
            if (!response.ok) {
                return null
            }
            const bytes = new Uint8Array(await response.arrayBuffer())
            const mime = response.headers.get('content-type') ?? ''
            return toResult(bytes, extensionOf(mime))
        } catch {
            return null
        }
    }
}

/** 归集所有可读文本：tool_result 的内容与 text block */
function collectText(blocks: ContentBlock[]): string {
    const parts: string[] = []
    for (const block of blocks) {
        if (block.type === 'text') {
            parts.push(block.text)
            continue
        }
        if (block.type !== 'tool_result') {
            continue
        }
        if (typeof block.content === 'string') {
            parts.push(block.content)
        } else if (Array.isArray(block.content)) {
            parts.push(collectText(block.content))
        }
    }
    return parts.join('\n')
}
