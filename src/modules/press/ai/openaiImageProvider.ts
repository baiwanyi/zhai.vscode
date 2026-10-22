/**
 * 直连图像通道：把配置与密钥收敛后交给 aiPortraitGenerator 的 fetch 实现。
 * 复用约定：端点 / 模型 / 尺寸 / 超时来自 common/config，密钥来自 SecretsService；
 * 出图协议细节（b64 与 url、错误翻译、体积上限）全部复用 aiPortraitGenerator。
 * 关键约束：能力判断只看「配置齐全 + 有密钥」，不发起探测请求，避免产生额外计费。
 */
import { generatePortraitWithAi } from './aiPortraitGenerator'
import type { ImageGenerateOptions, ImageGenerateResult, ImageProvider, ImageProviderId } from './imageProvider'
import type { SecretsService } from '../../common/secrets'
import { getZhaiConfig } from '../../common/config'

export class OpenAiImageProvider implements ImageProvider {
    public readonly id: ImageProviderId = 'openai'

    public constructor(private readonly secrets: SecretsService) {}

    public async isAvailable(): Promise<boolean> {
        const cfg = getZhaiConfig()
        if (cfg.imageBaseUrl.trim().length === 0 || cfg.imageModel.trim().length === 0) {
            return false
        }
        const apiKey = await this.secrets.get('imageApiKey')
        return typeof apiKey === 'string' && apiKey.length > 0
    }

    public async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
        const cfg = getZhaiConfig()
        const baseUrl = cfg.imageBaseUrl.trim()
        const model = cfg.imageModel.trim()
        if (baseUrl.length === 0 || model.length === 0) {
            throw new Error('未配置图像服务，请先在设置中填写 zhai.image.baseUrl 与 zhai.image.model')
        }
        const apiKey = await this.secrets.get('imageApiKey')
        if (!apiKey) {
            throw new Error('未配置图像服务 API Key，请执行「设置图像服务 API Key」命令后重试')
        }
        return generatePortraitWithAi({
            baseUrl,
            apiKey,
            model,
            size: options.size,
            timeoutMs: Math.max(cfg.imageTimeoutSeconds, 30) * 1000,
            prompt: options.prompt,
            signal: options.signal,
        })
    }
}
