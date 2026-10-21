/**
 * 角色设定图执行器：按 OpenAI 兼容的 /images/generations 协议请求一张图片并取回字节。
 * 复用约定：端点、模型、尺寸全部来自配置，本函数不读配置也不落盘；提示词由 ./portraitPrompt 提供。
 * 关键约束：接口返回视为不可信——data 数组、b64 与 url 逐字段校验；url 回源下载同样受同一超时约束；
 * 不强制 response_format，b64 与 url 两种返回都要能处理；单张体积设上限，避免异常大图写盘。
 */
import { Buffer } from 'node:buffer'
import { buildPortraitPrompt } from './portraitPrompt'
import type { PortraitGenerateRequest } from '../../../shared/types/press'

/** 图像生成整体超时：出图通常 10~40s，这里留足余量 */
const IMAGE_REQUEST_TIMEOUT_MS = 120_000
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
    const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)
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
            const detail = await response.text()
            throw new Error(`图像服务返回 ${response.status}：${detail.slice(0, 160) || '无详细信息'}`)
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
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
    }
}

/** 取响应里的第一张图：b64 与 url 至少有一个可用 */
function readFirstImage(payload: unknown): { base64: string | null; url: string | null } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('图像服务返回格式不支持')
    }
    const data = (payload as { data?: unknown }).data
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('图像服务未返回图片')
    }
    const first: unknown = data[0]
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

/** 校验图片体积 */
function assertImageSize(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
        throw new Error('图像服务返回了空图片')
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('图片体积超过上限，已放弃保存')
    }
}
