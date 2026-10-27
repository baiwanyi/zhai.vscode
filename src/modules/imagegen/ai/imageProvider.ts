/**
 * 图像通道契约与入口：把「英文提示词 → 一张图片字节」抽象出来。
 * 复用约定：与文本通道分离——按张计费与按 token 计费的成本结构、失败模式不同，故不并入 AiProvider；
 * 取消统一走 AbortSignal，产物统一归一为字节 + 扩展名，落盘由 imageGenerateService 负责。
 * 关键约束：实现唯一为 CodeBuddy 的 ImageGen；能力探测结果缓存，缺失即报错不静默重试，
 * 因为出图按张计费，静默重试会连扣两次。
 */
import type { AiUsage, AiUsageMeta } from '@modules/ai/provider'
import type { SecretsService } from '@modules/common/secrets'
import { CodeBuddyImageProvider } from './codebuddyImageProvider'

/** 图像通道标识 */
export type ImageProviderId = 'codebuddy'

/** 参考图类型：与文件魔数嗅探结果一致，扩展名只用于选择框过滤 */
export type ImageReferenceMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 参考图输入：字节与真实类型都已由宿主侧校验 */
export interface ImageReferenceInput {
    bytes: Uint8Array
    mimeType: ImageReferenceMimeType
}

/** 单次出图请求 */
export interface ImageGenerateOptions {
    /** 已组装好的英文提示词 */
    prompt: string
    /** 期望尺寸，形如 768x1024；通道不支持时忽略 */
    size: string
    /**
     * 参考图：作为多模态输入随指令提交，供模型观察主体、构图与色调。
     * 缺省或空数组即纯文生图，通道行为与不带参考图时完全一致。
     */
    references?: readonly ImageReferenceInput[]
    signal: AbortSignal
}

/** 单次出图产物 */
export interface ImageGenerateResult {
    bytes: Uint8Array
    extension: 'png' | 'jpg' | 'webp'
    /**
     * 本次出图的用量与请求标识：出图按张计费，图像工具的积分与文本消耗一并回传，
     * 由服务层写用量行并按 requestId 从 CLI 会话记录回填；通道未能回传时为 null。
     */
    usage?: AiUsage | null
    meta?: AiUsageMeta | null
    /** 请求开始时间戳：供服务层在通道未回传耗时时兜底 */
    startedAt?: number
}

/**
 * 出图入口的最小契约：上层服务只依赖这一层，通道实现与测试替身都可以注入。
 * 关键约束：不得在此层做重试——出图按张计费，重复调用即重复扣费。
 */
export interface ImageGenerator {
    generate(options: ImageGenerateOptions): Promise<ImageGenerateResult>
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

/** 图像通道入口：先探测能力再生成，失败后清缓存供下次重探 */
export class ImageProviderRouter implements ImageGenerator {
    private readonly provider: ImageProvider
    private availability: { isAvailable: boolean; checkedAt: number } | null = null

    public constructor(secrets: SecretsService) {
        this.provider = new CodeBuddyImageProvider(secrets)
    }

    public async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
        try {
            const isAvailable = await this.check()
            if (!isAvailable) {
                throw new Error('CodeBuddy 未提供出图能力（工具列表中缺少 ImageGen），请确认已登录并检查 CLI 版本')
            }
            return await this.provider.generate(options)
        } catch (error) {
            // 出图失败后让下次请求重新探测能力，避免一次性故障长期粘在缓存里
            this.invalidate()
            throw error
        }
    }

    /** 生成失败后重探：仅路由内部调用，避免外部误清缓存导致重复拉起探测子进程 */
    private invalidate(): void {
        this.availability = null
    }

    private async check(): Promise<boolean> {
        const now = Date.now()
        if (this.availability !== null && now - this.availability.checkedAt < PROBE_TTL_MS) {
            return this.availability.isAvailable
        }
        const isAvailable = await this.provider.isAvailable()
        this.availability = { isAvailable, checkedAt: now }
        return isAvailable
    }
}
