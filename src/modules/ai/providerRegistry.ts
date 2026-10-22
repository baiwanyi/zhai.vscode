/**
 * AI 通道装配：当前只装配 CodeBuddy 通道（CLI 登录态，可选 API Key）。
 * 复用约定：业务服务通过构造参数注入实例，不直接 import 具体实现；
 * 关键约束：全扩展只创建一个实例——实例内部会持有 CLI 子进程句柄，
 * 多实例会让同一会话出现并行进程；模型 id 由 zhai.ai.codebuddyModel 决定。
 */
import { CodeBuddyProvider } from './providers/codebuddy'
import type { AiProvider } from './provider'
import type { SecretsService } from '../common/secrets'

/** 创建当前生效的通道：唯一实现为 CodeBuddy，凭证由通道在请求阶段自取 */
export function createAiProvider(secrets: SecretsService): Promise<AiProvider> {
    return Promise.resolve(new CodeBuddyProvider(secrets))
}
