/**
 * 角色设定图执行器：按 OpenAI 兼容的 /images/generations 协议请求一张图片并取回字节。
 * 复用约定：端点、模型、尺寸、超时全部来自配置，本函数不读配置也不落盘；提示词由 ./portraitPrompt 提供。
 * 关键约束：接口返回视为不可信——data / results 两种列表、b64 与 url 两种载荷都要支持；
 * url 回源下载同样受同一超时约束；超时与用户取消给出不同文案，不把两者混成「已取消」；
 * 不强制 response_format，也不假设 n 被服务端采纳；单张体积设上限，避免异常大图写盘。
 */
import { Buffer } from 'node:buffer'
import { buildPortraitPrompt } from './portraitPrompt'
import type { PortraitGenerateRequest } from '../../../shared/types/press'

/** 单张图片体积上限 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
/** 响应 MIME 到落盘扩展名的映射 */
const EXTENSION_BY_MIME: Readonly<Record<string, 'png' | 'jpg' | 'webp'>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
}

export interface AiPortraitOptions {
    baseUrl: string
    apiKey: string
    model: string
    size: string
    /** 单次生成整体超时（毫秒），由配置 zhai.image.timeoutSeconds 决定 */
    timeoutMs: number
    request: PortraitGenerateRequest
    /** 外部取消信号（pressAi/aiPortrait/abort） */
    signal?: AbortSignal
}

export interface AiPortraitResult {
    bytes: Uint8Array
    extension: 'png' | 'jpg' | 'webp'
}

/** 生成一张角色设定图，返回图片字节与扩展名 */
export async function generatePortraitWithAi(options: AiPortraitOptions): Promise<AiPortraitResult> {
    const controller = new AbortController()
    let isTimedOut = false
    const timer = setTimeout(() => {
        isTimedOut = true
        controller.abort()
    }, options.timeoutMs)
    const forwardAbort = (): void => controller.abort()
    if (options.signal) {
        if (options.signal.aborted) {
            controller.abort()
        } else {
            options.signal.addEventListener('abort', forwardAbort, { once: true })
        }
    }
    try {
        const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/images/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
                model: options.model,
                prompt: buildPortraitPrompt(options.request),
                n: 1,
                size: options.size,
            }),
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(describeImageFailure(response.status, await response.text()))
        }
        const image = readFirstImage(await response.json())
        if (image.base64 !== null) {
            const bytes = new Uint8Array(Buffer.from(image.base64, 'base64'))
            assertImageSize(bytes)
            return { bytes, extension: 'png' }
        }
        if (image.url === null) {
            throw new Error('图像服务未返回可用的图片数据')
        }
        const imageResponse = await fetch(image.url, { signal: controller.signal })
        if (!imageResponse.ok) {
            throw new Error(`图片下载失败：${imageResponse.status}`)
        }
        const bytes = new Uint8Array(await imageResponse.arrayBuffer())
        assertImageSize(bytes)
        const mime = imageResponse.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        return { bytes, extension: EXTENSION_BY_MIME[mime] ?? 'png' }
    } catch (error) {
        if (isTimedOut) {
            const seconds = Math.round(options.timeoutMs / 1000)
            throw new Error(`图像服务响应超时（${seconds} 秒），可在设置中调高 zhai.image.timeoutSeconds 后重试`, {
                cause: error,
            })
        }
        if (controller.signal.aborted) {
            throw new Error('角色卡生成已取消', { cause: error })
        }
        // Node 自带的连接 / 响应超时（undici）可能与配置超时接近，统一按超时提示
        const code = readErrorCode(error)
        if (
            code === 'UND_ERR_BODY_TIMEOUT' ||
            code === 'UND_ERR_HEADERS_TIMEOUT' ||
            code === 'UND_ERR_CONNECT_TIMEOUT'
        ) {
            throw new Error('图像服务长时间无响应（连接或响应超时），可稍后重试', { cause: error })
        }
        // 我方主动抛出的中文错误直接透传，其余（网络层）补一层可读前缀
        if (error instanceof Error && error.message.startsWith('图像服务')) {
            throw error
        }
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`图像服务请求失败：${detail}`, { cause: error })
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
    }
}

/** 取响应里的第一张图：兼容 data[] 与 results[]，b64 与 url 至少有一个可用 */
function readFirstImage(payload: unknown): { base64: string | null; url: string | null } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('图像服务返回格式不支持')
    }
    const record = payload as { data?: unknown; results?: unknown; status?: unknown }
    const list = Array.isArray(record.data) ? record.data : Array.isArray(record.results) ? record.results : null
    if (list === null || list.length === 0) {
        const status = typeof record.status === 'string' ? record.status : ''
        throw new Error(status.length > 0 ? `图像任务状态为 ${status}，未返回图片` : '图像服务未返回图片')
    }
    const first: unknown = list[0]
    if (typeof first !== 'object' || first === null) {
        throw new Error('图像服务返回格式不支持')
    }
    const base64 = (first as { b64_json?: unknown }).b64_json
    const url = (first as { url?: unknown }).url
    return {
        base64: typeof base64 === 'string' && base64.length > 0 ? base64 : null,
        url: typeof url === 'string' && /^https?:\/\//.test(url) ? url : null,
    }
}

/** 上游过载 / 限流的关键字，命中后统一提示「繁忙」，避免把英文原文抛给用户 */
const OVERLOAD_HINT =
    /excessive system load|overloaded|over capacity|too many requests|rate limit|server is busy|temporarily unavailable/i

/** 把非 2xx 响应翻译成可读中文；返回值统一以「图像服务」开头，便于上层原样透传 */
function describeImageFailure(status: number, body: string): string {
    const detail = readFailureMessage(body)
    if (status === 429 || status === 503 || OVERLOAD_HINT.test(detail)) {
        return '图像服务当前繁忙（服务商负载过高），请稍后重试；连续失败可更换模型或稍等片刻'
    }
    if (status === 401 || status === 403) {
        return `图像服务鉴权失败（${status}），请检查 zhai.image.apiKey 是否正确`
    }
    if (status === 404) {
        return '图像服务未找到对应接口或模型（404），请检查 zhai.image.baseUrl 与 zhai.image.model'
    }
    if (status >= 500) {
        return `图像服务内部错误（${status}），请稍后重试`
    }
    if (detail.length > 0) {
        return `图像服务返回 ${status}：${detail.slice(0, 160)}`
    }
    return `图像服务返回 ${status}`
}

/** 从错误响应体提取可读信息：兼容 {error:{message}}、{error:'...'}、{message}、{detail} 与纯文本 */
function readFailureMessage(body: string): string {
    const text = body.trim()
    if (text.length === 0) {
        return ''
    }
    const payload = parseJsonQuietly(text)
    if (typeof payload !== 'object' || payload === null) {
        return text.slice(0, 160)
    }
    const record = payload as { error?: unknown; message?: unknown; detail?: unknown }
    const nested =
        typeof record.error === 'object' && record.error !== null
            ? (record.error as { message?: unknown }).message
            : record.error
    const candidate = [nested, record.message, record.detail].find(
        (item) => typeof item === 'string' && item.length > 0,
    )
    return typeof candidate === 'string' ? candidate : text.slice(0, 160)
}

/** 宽松解析 JSON：失败或字面量 null 一律返回 null，交由调用方按纯文本处理 */
function parseJsonQuietly(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

/** 读取 fetch 底层错误码（undici 把原因放在 cause 上） */
function readErrorCode(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
        return ''
    }
    const cause: unknown = (error as { cause?: unknown }).cause
    if (typeof cause !== 'object' || cause === null) {
        return ''
    }
    const code = (cause as { code?: unknown }).code
    return typeof code === 'string' ? code : ''
}

/** 校验图片体积 */
function assertImageSize(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
        throw new Error('图像服务返回了空图片')
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('图片体积超过上限，已放弃保存')
    }
}
