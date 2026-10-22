/**
 * 图像通道契约与路由：把「英文提示词 → 一张图片字节」抽象为可切换实现。
 * 复用约定：与文本通道分离——按张计费与按 token 计费的成本结构、失败模式不同，故不并入 AiProvider；
 * 取消统一走 AbortSignal，产物统一归一为字节 + 扩展名，落盘由 portraitService 负责。
 * 关键约束：能力探测与生成解耦且结果缓存；能力缺失才自动回退，生成失败只提示不重试，
 * 因为出图按张计费，静默重试会连扣两次。
 */
import { CodeBuddyImageProvider } from './codebuddyImageProvider'
import { OpenAiImageProvider } from './openaiImageProvider'
import type { SecretsService } from '../../common/secrets'
import { getZhaiConfig } from '../../common/config'

/** 图像通道标识：配置项 zhai.image.provider 的取值来源 */
export type ImageProviderId = 'codebuddy' | 'openai'

/** 单次出图请求 */
export interface ImageGenerateOptions {
    /** 已组装好的英文提示词 */
    prompt: string
    /** 期望尺寸，形如 768x1024；通道不支持时忽略 */
    size: string
    signal: AbortSignal
}

/** 单次出图产物 */
export interface ImageGenerateResult {
    bytes: Uint8Array
    extension: 'png' | 'jpg' | 'webp'
}

/** 图像通道实现 */
export interface ImageProvider {
    readonly id: ImageProviderId
    /** 通道是否具备出图能力；实现不得在此发起实际生成 */
    isAvailable(): Promise<boolean>
    generate(options: ImageGenerateOptions): Promise<ImageGenerateResult>
}

/** 能力探测结果缓存时长：避免每次出图都拉起子进程 */
const PROBE_TTL_MS = 10 * 60 * 1000

/** 路由结果：带上实际使用的通道与回退原因，便于界面说明 */
export interface ImageRouteResult {
    result: ImageGenerateResult
    providerId: ImageProviderId
    /** 非空表示发生了能力回退，文案可直接展示 */
    fallbackReason?: string
}

/**
 * 图像通道路由：按配置与能力探测选择实现。
 * auto 只在 CodeBuddy 具备 ImageGen 时选它，否则走直连并回报原因。
 */
export class ImageProviderRouter {
    private readonly providers: Record<ImageProviderId, ImageProvider>
    private readonly availability = new Map<ImageProviderId, { isAvailable: boolean; checkedAt: number }>()

    public constructor(secrets: SecretsService) {
        this.providers = {
            codebuddy: new CodeBuddyImageProvider(secrets),
            openai: new OpenAiImageProvider(secrets),
        }
    }

    public async generate(options: ImageGenerateOptions): Promise<ImageRouteResult> {
        try {
            return await this.route(options)
        } catch (error) {
            // 出图失败后让下次请求重新探测能力，避免一次性故障长期粘在缓存里
            this.invalidate()
            throw error
        }
    }

    private async route(options: ImageGenerateOptions): Promise<ImageRouteResult> {
        const preferred = getZhaiConfig().imageProvider
        if (preferred === 'openai') {
            return { result: await this.providers.openai.generate(options), providerId: 'openai' }
        }
        const isCodebuddyAvailable = await this.check('codebuddy')
        if (isCodebuddyAvailable) {
            return { result: await this.providers.codebuddy.generate(options), providerId: 'codebuddy' }
        }
        if (preferred === 'codebuddy') {
            const error = new Error('CodeBuddy 未提供出图能力（工具列表中缺少 ImageGen），请改用直连通道')
            // 显式选择时不做静默回退，交由用户切换配置
            throw error
        }
        return {
            result: await this.providers.openai.generate(options),
            providerId: 'openai',
            fallbackReason: 'CodeBuddy 未提供出图能力，已改用直连图像服务',
        }
    }

    /** 生成失败后调用：让下次请求重新探测，避免一次性故障长期粘住 */
    public invalidate(): void {
        this.availability.clear()
    }

    private async check(id: ImageProviderId): Promise<boolean> {
        const cached = this.availability.get(id)
        const now = Date.now()
        if (cached !== undefined && now - cached.checkedAt < PROBE_TTL_MS) {
            return cached.isAvailable
        }
        const isAvailable = await this.providers[id].isAvailable()
        this.availability.set(id, { isAvailable, checkedAt: now })
        return isAvailable
    }
}
