/**
 * CodeBuddy 可用模型清单：拉取当前账号支持的模型并缓存，供模型选择命令与通道校验复用。
 * 复用约定：经 SDK createSession 的 getAvailableModels 取列表，站点与凭证沿用 codebuddySite 的映射；
 * 关键约束：拉取需拉起 CLI 子进程（数秒）且要求已登录，失败一律降级为空列表、不阻断激活；
 * 缓存只存在内存（站点或账号变化即失效），由命令的强制刷新或下次激活重建。
 * 清单只含语言模型，文生图模型由服务端产品配置决定，不予枚举。
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
 * 归一模型名：空表示交给 CLI 默认；非空一律透传，支持填写账号可用的自定义模型 id。
 * 关键约束：id 是否有效由服务端裁决，失败时通道会转出「模型不可用」的可读提示，故此处不做清单拦截。
 */
export function resolveCodebuddyModel(model: string): string | undefined {
    const trimmed = model.trim()
    return trimmed.length === 0 ? undefined : trimmed
}
