/**
 * CodeBuddy 图像通道：经 Agent SDK 调用 CLI 内置的 ImageGen 工具出图。
 * 复用约定：提示词与尺寸由调用方给出，本层只负责拼指令、驱动工具、把产物归一为字节；
 * 凭证优先取 SecretStorage 的 CodeBuddy API Key，缺省沿用 CLI 登录态。
 * 关键约束：只放行 ImageGen 并限制最大轮次（模型常先输出说明、再调用工具、最后收尾）；
 * 工具结果一落地即尝试取图，避免收尾轮被轮次上限截断导致整次作废；ImageGen 以 JSON 文本回报产物（images[].localPath），
 * 路径可能不带扩展名，格式一律按文件魔数判定；同时兼容 image block / data URL / 链接等形态，
 * 逐候选校验，全部失败时记录诊断并明确报错，不返回空图。
 */
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { query } from '@tencent-ai/agent-sdk'
import type { ImageGenerateOptions, ImageGenerateResult, ImageProvider, ImageProviderId } from './imageProvider'
import type { CodebuddySite } from '../../common/config'
import type { SecretsService } from '../../common/secrets'
import type { ContentBlock, PermissionResult } from '@tencent-ai/agent-sdk'
import { resolveCodebuddyModel } from '../../ai/providers/codebuddyModels'
import { buildCodebuddyEnv, CODEBUDDY_SITE_LABELS } from '../../ai/providers/codebuddySite'
import { getZhaiConfig } from '../../common/config'
import { logger } from '../../common/logger'

/** 单张图片体积上限，与直连通道保持一致 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
/**
 * 单次出图允许的最大轮次。
 * 模型常见的三段式响应是「文字说明 → 调用 ImageGen → 收尾回复」，任何多出来的一次试探
 * 都会让轮次刚好用尽并抛 Max turns；给足余量比事后判定更可靠。
 */
const MAX_TURNS = 5
/** 单次响应最多尝试的候选数，避免长文本里逐个试错 */
const MAX_CANDIDATES = 16
/** 结构化产物字段：ImageGen 用 images[].localPath，其余形态用它兜底 */
const ARTIFACT_FIELD_PATTERN = /"(?:localPath|local_path|filePath|file_path|path|url)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi
/** 内联图片数据：部分模型会把图直接以 base64 返回 */
const DATA_URL_PATTERN = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi
/** 文本中的绝对路径：不限扩展名，格式由内容嗅探判定 */
const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/)[^\s"'<>(){},;]+/g
/** 文本中的链接：不限扩展名，下载后同样按内容嗅探 */
const URL_PATTERN = /(?:https?|file):\/\/[^\s"'<>(){},;]+/g
/** ImageGen 的完成标记：只在工具明确回报完成时才取图，避免把写到一半的文件当成产物 */
const IMAGE_DONE_PATTERN = /image_gen_tool_result|"status"\s*:\s*"completed"/i

/**
 * 工具授权：只放行 ImageGen，其余一律拒绝；整次请求最多放行一次。
 * 关键约束：出图按张计费，放开轮次后模型可能连续调用 ImageGen，第二次起必须拒绝，否则会重复扣费。
 */
function createImageGenGate(): (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult> {
    let hasGranted = false
    return (toolName, input) => {
        if (toolName !== 'ImageGen') {
            return Promise.resolve({ behavior: 'deny', message: `仅允许 ImageGen，已拒绝 ${toolName}` })
        }
        if (hasGranted) {
            logger.warn('CodeBuddy 模型再次调用 ImageGen，已拒绝以避免重复出图计费')
            return Promise.resolve({ behavior: 'deny', message: '本次请求已生成过图片，请直接结束，不要重复出图' })
        }
        hasGranted = true
        logger.info('CodeBuddy 已放行 ImageGen（本次请求最多一次）')
        return Promise.resolve({ behavior: 'allow', updatedInput: input })
    }
}

/**
 * 图像通道的子进程环境：在站点变量之外关闭工具延迟加载。
 * CLI 默认把 ImageGen 之类重量级工具放进延迟加载池，只留给 ToolSearch 检索；
 * 本通道限定 tools 为 ImageGen，若不关闭延迟加载，模型可用工具列表里就没有它。
 */
function buildImageEnv(site: CodebuddySite, apiKey?: string): Record<string, string> {
    const env = buildCodebuddyEnv(site, apiKey) ?? {}
    return { ...env, CODEBUDDY_DEFER_TOOL_LOADING: 'false' }
}

/** 拼出交给模型的出图指令：要求只调用工具并回报路径，避免它继续解释画面 */
function buildInstruction(options: ImageGenerateOptions): string {
    return [
        '请立即调用 ImageGen 工具生成一张图片，不要先用文字说明或复述画面，也不要用文字描述代替出图。',
        `画面要求：${options.prompt}`,
        `尺寸：${options.size}`,
        '完成后只回复图片的本地绝对路径或可访问链接，不要附加其他说明。',
    ].join('\n')
}

/** 把 SDK 的原始错误转成可执行提示 */
function toReadableError(error: unknown, model?: string): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (/authentication required|please (use|run) \/login/i.test(message)) {
        const site = CODEBUDDY_SITE_LABELS[getZhaiConfig().aiCodebuddySite]
        return new Error(`尚未登录 CodeBuddy（${site}）：请执行「宅写作：登录 CodeBuddy」后重试`, { cause: error })
    }
    if (/service info not found|supported models for your account/i.test(message)) {
        const label = model !== undefined && model.length > 0 ? `「${model}」` : '当前模型'
        return new Error(
            `CodeBuddy 模型不可用：${label}不在当前账号的可用列表，请执行「宅写作：选择 CodeBuddy 模型」重新选择（或留空使用默认模型）`,
            { cause: error },
        )
    }
    if (/max turns/i.test(message)) {
        return new Error('CodeBuddy 出图未完成（工具轮次已用尽），请重试或改用直连服务', { cause: error })
    }
    return error instanceof Error ? error : new Error(message)
}

/** 按文件头判定图片格式：产物路径可能没有扩展名，不能只看文件名 */
function sniffImageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'jpg'
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'webp'
    }
    return null
}

/** 校验并归一图片体积；非图片内容返回 null，交给下一个候选 */
function toResult(bytes: Uint8Array): ImageGenerateResult | null {
    const extension = sniffImageExtension(bytes)
    if (extension === null) {
        return null
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('图片体积超过上限，已放弃保存')
    }
    return { bytes, extension }
}

/** 解码 base64 或 data URL 的载荷 */
function decodeBase64(data: string): ImageGenerateResult | null {
    const cleaned = data.replace(/\s+/g, '')
    return toResult(new Uint8Array(Buffer.from(cleaned, 'base64')))
}

/** 还原 JSON 字符串字面量的转义（Windows 路径在 JSON 里是双反斜杠） */
function unquoteJsonString(value: string): string | null {
    try {
        const parsed: unknown = JSON.parse(`"${value}"`)
        return typeof parsed === 'string' ? parsed : null
    } catch {
        return null
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

/** 展平内容块：工具结果里的图片块同样要参与解析 */
function collectBlocks(blocks: ContentBlock[]): ContentBlock[] {
    const flat: ContentBlock[] = []
    for (const block of blocks) {
        flat.push(block)
        if (block.type === 'tool_result' && Array.isArray(block.content)) {
            flat.push(...collectBlocks(block.content))
        }
    }
    return flat
}

/** 从文本里按可信度收集候选：结构化字段 → 内联数据 → 绝对路径 → 链接 */
function collectCandidates(text: string): string[] {
    const candidates: string[] = []
    const push = (value: string | null | undefined): void => {
        if (typeof value !== 'string') {
            return
        }
        const trimmed = value.trim()
        if (trimmed.length > 0 && !candidates.includes(trimmed)) {
            candidates.push(trimmed)
        }
    }
    for (const match of text.matchAll(ARTIFACT_FIELD_PATTERN)) {
        const raw: string | undefined = match[1]
        if (raw !== undefined) {
            push(unquoteJsonString(raw) ?? raw)
        }
    }
    for (const match of text.matchAll(DATA_URL_PATTERN)) {
        push(match[0])
    }
    for (const match of text.matchAll(ABSOLUTE_PATH_PATTERN)) {
        push(match[0])
    }
    for (const match of text.matchAll(URL_PATTERN)) {
        push(match[0])
    }
    return candidates.slice(0, MAX_CANDIDATES)
}

/** 日志里的文本摘要：内联图片数据只保留标记，避免刷屏 */
function summarizeForLog(blocks: ContentBlock[]): string {
    const types = collectBlocks(blocks)
        .map((block) => block.type)
        .join(',')
    const text = collectText(blocks).replace(DATA_URL_PATTERN, 'data:image/(base64 省略)').replace(/\s+/g, ' ').trim()
    return `块类型=[${types}] 文本=${text.length > 0 ? text.slice(0, 400) : '(空)'}`
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
                env: buildImageEnv(getZhaiConfig().aiCodebuddySite),
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
        const model = resolveCodebuddyModel(cfg.imageCodebuddyModel)
        const session = query({
            prompt: buildInstruction(options),
            options: {
                // 仅放行出图工具，避免模型顺带读写工作区；allowedTools + canUseTool 双重放行才会真正执行
                tools: ['ImageGen'],
                allowedTools: ['ImageGen'],
                canUseTool: createImageGenGate(),
                // 出图通常需要三轮（说明 / 工具 / 收尾），按 MAX_TURNS 留出试探余量，避免中途被截断
                maxTurns: MAX_TURNS,
                permissionMode: 'default',
                includePartialMessages: false,
                cwd: tmpdir(),
                // 驱动模型同样必须落在账号可用列表内，否则 CLI 直接 400
                model,
                abortController: controller,
                env: buildImageEnv(cfg.aiCodebuddySite, apiKey),
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
                    // 工具结果一到手就先取图：即使后续收尾轮触发 Max turns，本次也能正常交付
                    if (IMAGE_DONE_PATTERN.test(collectText(blocks))) {
                        const artifact = await this.readArtifactWithRetry(blocks)
                        if (artifact !== null) {
                            return artifact
                        }
                    }
                    continue
                }
                if (message.type === 'result' && message.subtype !== 'success') {
                    failure = message.errors?.join('；') ?? message.subtype
                }
            }
        } catch (error) {
            // 工具已出图、仅收尾轮次失败时，优先交出已拿到的产物
            const artifact = await this.readArtifact(blocks)
            if (artifact !== null) {
                return artifact
            }
            logger.warn(`CodeBuddy 出图中断且未取到产物：${summarizeForLog(blocks)}`)
            throw toReadableError(error, cfg.imageCodebuddyModel)
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
            logger.warn(`CodeBuddy 出图产物无法解析：${summarizeForLog(blocks)}`)
            const detail = collectText(blocks).replace(DATA_URL_PATTERN, '').replace(/\s+/g, ' ').trim()
            if (detail.length > 0) {
                throw new Error(`CodeBuddy 出图失败：${detail.slice(0, 200)}`)
            }
            throw new Error('CodeBuddy 未返回可识别的图片（已检查本地路径、链接与内联数据），请检查该通道的出图能力或改用直连服务')
        }
        return artifact
    }

    /**
     * 拿到完成标记后的读取：产物可能仍在落盘，首次读不到不应立刻放行后续轮次。
     * 最多读 3 次、间隔 300ms，既覆盖写盘抖动，也避免长时间空等。
     */
    private async readArtifactWithRetry(blocks: ContentBlock[]): Promise<ImageGenerateResult | null> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const artifact = await this.readArtifact(blocks)
            if (artifact !== null) {
                return artifact
            }
            if (attempt < 2) {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 300)
                })
            }
        }
        return null
    }

    /** 先找 image block，再按候选顺序解析文本产物 */
    private async readArtifact(blocks: ContentBlock[]): Promise<ImageGenerateResult | null> {
        for (const block of collectBlocks(blocks)) {
            const artifact = block.type === 'image' ? await this.readImageBlock(block) : null
            if (artifact !== null) {
                return artifact
            }
        }
        for (const candidate of collectCandidates(collectText(blocks))) {
            const artifact = await this.readCandidate(candidate)
            if (artifact !== null) {
                return artifact
            }
        }
        return null
    }

    private async readImageBlock(block: ContentBlock): Promise<ImageGenerateResult | null> {
        if (block.type !== 'image') {
            return null
        }
        return block.source.type === 'base64' ? decodeBase64(block.source.data) : this.readCandidate(block.source.url)
    }

    /** 单个候选：内联数据 / 链接 / 本地路径，统一按内容嗅探校验 */
    private async readCandidate(value: string): Promise<ImageGenerateResult | null> {
        if (value.startsWith('data:image/')) {
            const separator = value.indexOf(',')
            return separator < 0 ? null : decodeBase64(value.slice(separator + 1))
        }
        if (value.startsWith('file://')) {
            try {
                return await this.readFile(fileURLToPath(value))
            } catch {
                return null
            }
        }
        if (/^https?:\/\//i.test(value)) {
            return this.download(value)
        }
        return this.readFile(value)
    }

    private async readFile(path: string): Promise<ImageGenerateResult | null> {
        try {
            return toResult(new Uint8Array(await readFile(path)))
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
            return toResult(new Uint8Array(await response.arrayBuffer()))
        } catch {
            return null
        }
    }
}
