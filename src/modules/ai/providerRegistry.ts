/**
 * AI 通道装配：把「配置 + 凭证」收敛到一处，向扩展入口返回当前生效的通道实例。
 * 复用约定：配置经 common/config 读取、凭证经 common/secrets 读取，本层不保存配置副本；
 * 业务服务通过构造参数注入实例，不直接 import 具体实现，便于后续按需切换。
 * 关键约束：全扩展只创建一个实例——实例内部可能持有子进程或会话句柄，
 * 多实例会导致同一会话出现并行通道；通道切换需连同服务一起重建。
 */
import { DeepSeekProvider } from './providers/deepseek'
import type { AiProvider } from './provider'
import type { SecretsService } from '../common/secrets'

/** 创建当前生效的通道：默认 DeepSeek 直连 */
export function createAiProvider(secrets: SecretsService): AiProvider {
    return new DeepSeekProvider(secrets)
}
