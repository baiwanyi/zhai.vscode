/**
 * CodeBuddy 可用模型清单：拉取当前账号支持的模型并缓存，供模型选择命令与通道校验复用。
 * 复用约定：经 SDK createSession 的 getAvailableModels 取列表，站点与凭证沿用 codebuddySite 的映射；
 * 关键约束：拉取需拉起 CLI 子进程（数秒）且要求已登录，失败一律降级为空列表、不阻断激活；
 * 缓存只存在内存（站点或账号变化即失效），由命令的强制刷新或下次激活重建。
 */
import { tmpdir } from 'node:os'
import { unstable_v2_createSession } from '@tencent-ai/agent-sdk'
import { buildCodebuddyEnv } from './codebuddySite'
import type { SecretsService } from '../../common/secrets'
import { getZhaiConfig } from '../../common/config'

/** 单个可选模型 */
export interface CodebuddyModelOption {
    /** CLI 认可的模型 id，可直接作为 --model 下发 */
    modelId: string
    /** 展示名 */
    name: string
}

let cached: CodebuddyModelOption[] = []
let inflight: Promise<CodebuddyModelOption[]> | null = null

/** 已缓存的模型清单；为空表示尚未拉取成功（未登录或首启未完成） */
export function getCachedCodebuddyModels(): readonly CodebuddyModelOption[] {
    return cached
}

/** 拉取账号可用模型；force 为 true 时忽略内存缓存 */
export function listCodebuddyModels(secrets: SecretsService, force = false): Promise<CodebuddyModelOption[]> {
    if (!force && cached.length > 0) {
        return Promise.resolve(cached)
    }
    if (inflight !== null) {
        return inflight
    }
    inflight = fetchModels(secrets).finally(() => {
        inflight = null
    })
    return inflight
}

async function fetchModels(secrets: SecretsService): Promise<CodebuddyModelOption[]> {
    const site = getZhaiConfig().aiCodebuddySite
    const apiKey = await secrets.get('codebuddyApiKey')
    const session = unstable_v2_createSession({
        cwd: tmpdir(),
        env: buildCodebuddyEnv(site, apiKey),
    })
    try {
        const models = await session.getAvailableModels()
        cached = models.map((model) => ({ modelId: model.modelId, name: model.name }))
        return cached
    } catch {
        return []
    } finally {
        session.close()
    }
}

/**
 * 校验并归一模型名：只有 CLI 认可的模型才下发，否则交回默认模型。
 * 清单尚未拉到时沿用历史规则过滤 DeepSeek 直连模型名，避免把 deepseek-chat 这类名字传给 CLI。
 */
export function resolveCodebuddyModel(model: string): string | undefined {
    const trimmed = model.trim()
    if (trimmed.length === 0) {
        return undefined
    }
    if (cached.length > 0) {
        return cached.some((item) => item.modelId === trimmed) ? trimmed : undefined
    }
    return trimmed.startsWith('deepseek-') ? undefined : trimmed
}
