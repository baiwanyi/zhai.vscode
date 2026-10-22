/**
 * DeepSeek 通道：复用 ../client 的 streamChat（openai SDK，DeepSeek 兼容 OpenAI 协议）完成流式生成。
 * 复用约定：请求与增量结构由 ../provider 定义，与 client 的 ChatStream* 一致，可直接转交；
 * 凭证从 SecretsService 即时读取，不缓存，跟随用户设置变更。
 * 关键约束：缺失密钥时抛出与改造前一致的文案，避免上层提示出现差异；本实现不持有跨请求状态。
 */
import type { SecretsService } from '../../common/secrets'
import type { AiProvider, AiProviderId, AiStreamChunk, AiStreamRequest } from '../provider'
import { streamChat } from '../client'

/** 缺失密钥提示：与改造前会话服务、取名、外貌生成的文案保持一致 */
const MISSING_KEY_MESSAGE = '未配置 DeepSeek API Key，请先在插件设置中配置后重试'

export class DeepSeekProvider implements AiProvider {
    public readonly id: AiProviderId = 'deepseek'

    public constructor(private readonly secrets: SecretsService) {}

    public async *stream(request: AiStreamRequest): AsyncGenerator<AiStreamChunk> {
        const apiKey = await this.secrets.get('deepseekApiKey')
        if (!apiKey) {
            throw new Error(MISSING_KEY_MESSAGE)
        }
        yield* streamChat({
            apiKey,
            model: request.model,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            messages: request.messages,
            signal: request.signal,
        })
    }
}
