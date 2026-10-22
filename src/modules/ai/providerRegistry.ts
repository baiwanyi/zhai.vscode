/**
 * AI 通道装配：把「配置 + 凭证」收敛到一处，向扩展入口返回当前生效的通道实例。
 * 复用约定：配置经 common/config 读取、凭证经 common/secrets 读取，本层不保存配置副本；
 * 业务服务通过构造参数注入实例，不直接 import 具体实现。
 * 关键约束：全扩展只创建一个实例——实例内部会持有 CLI 子进程句柄，
 * 多实例会让同一会话出现并行进程；切换通道需重启窗口（激活期装配一次）。
 */
import { CodeBuddyProvider } from './providers/codebuddy'
import { DeepSeekProvider } from './providers/deepseek'
import type { AiProvider } from './provider'
import type { SecretsService } from '../common/secrets'
import { getZhaiConfig } from '../common/config'

/**
 * 创建当前生效的通道。
 * auto 模式只按「是否配置 CodeBuddy 凭证」判断：未配置时保持直连，避免未登录用户被直接阻断；
 * 显式选择 codebuddy 时即使无凭证也交给该通道，由通道在请求阶段给出可读错误。
 */
export async function createAiProvider(secrets: SecretsService): Promise<AiProvider> {
    const { aiProvider } = getZhaiConfig()
    if (aiProvider === 'deepseek') {
        return new DeepSeekProvider(secrets)
    }
    if (aiProvider === 'codebuddy') {
        return new CodeBuddyProvider(secrets)
    }
    const codebuddyKey = await secrets.get('codebuddyApiKey')
    return codebuddyKey ? new CodeBuddyProvider(secrets) : new DeepSeekProvider(secrets)
}
