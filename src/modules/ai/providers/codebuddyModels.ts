/**
 * CodeBuddy 可用模型清单与当前选择：拉取账号支持的模型并缓存，同时把面板菜单选中的模型持久化到 globalState。
 * 复用约定：经 SDK createSession 的 getAvailableModelsRaw 取完整清单（含额度倍率 credits），
 * 站点与凭证沿用 codebuddySite 的映射；完整清单不可用时退回 getAvailableModels 的简化清单；
 * 关键约束：清单拉取需拉起 CLI 子进程（数秒）且要求已登录，失败一律降级为空列表、不阻断激活；
 * 选中值以内存副本供各通道同步读取，写入时才落 globalState —— 配置项已移除，面板菜单是唯一入口；
 * 额度倍率为平台下发文本，解析不出数值时记 null 表示未知，不得回退为 0。
 * 清单只含语言模型，文生图模型由服务端产品配置决定，不予枚举。
 */
import { tmpdir } from 'node:os'
import { unstable_v2_createSession } from '@tencent-ai/agent-sdk'
import { getZhaiConfig } from '@modules/common/config'
import type { SecretsService } from '@modules/common/secrets'
import { buildCodebuddyEnv } from './codebuddySite'
import type { Memento } from 'vscode'

/** 单个可选模型 */
export interface CodebuddyModelOption {
    /** CLI 认可的模型 id，可直接作为 --model 下发 */
    modelId: string
    /** 展示名 */
    name: string
    /** 平台下发的额度倍率原文（如 "x0.51 credits"）；自定义模型未上报时为 null */
    credits: string | null
    /** 解析后的额度倍率（每次调用消耗的 credits 系数），无法解析时为 null */
    creditRate: number | null
    /** 是否为用户自定义模型：菜单据此拆分为「内置模型」「自定义模型」两组 */
    custom: boolean
}

/** 自定义模型 id 前缀：CLI 把用户自建模型统一挂在该前缀下 */
const CUSTOM_MODEL_PREFIX = 'custom-local:'

/** 模型选择的持久化键 */
const MODEL_STATE_KEY = 'ai.codebuddyModel'

let cached: CodebuddyModelOption[] = []
let inflight: Promise<CodebuddyModelOption[]> | null = null
/** 已选模型的内存副本：各通道同步读取，避免每次穿透 globalState */
let activeModel = ''

/** 激活时从 globalState 载入已选模型 */
export function hydrateSelectedModel(state: Memento): void {
    activeModel = state.get<string>(MODEL_STATE_KEY, '') ?? ''
}

/** 当前模型 id：空表示交给 CLI 默认模型 */
export function getSelectedCodebuddyModel(): string {
    return activeModel
}

/** 写入选择结果：空字符串表示恢复默认模型 */
export async function setSelectedCodebuddyModel(state: Memento, modelId: string): Promise<void> {
    activeModel = modelId.trim()
    await state.update(MODEL_STATE_KEY, activeModel)
}

/** 已缓存的模型清单；为空表示尚未拉取成功（未登录或首启未完成） */
export function getCachedCodebuddyModels(): readonly CodebuddyModelOption[] {
    return cached
}

/**
 * 按模型 id 取额度倍率：用于用量记账估算积分。
 * 关键约束：清单未命中（未登录、Auto 空 id、自定义模型未上报倍率）一律返回 null 表示未知，
 * 不得回退为 0，否则会把未知成本显示成零消耗。
 */
export function readCreditRate(modelId: string): number | null {
    const matched = cached.find((item) => item.modelId === modelId.trim())
    return matched?.creditRate ?? null
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
        // 完整清单才带额度倍率（credits），是「每个模型的成本消耗速率」的唯一来源
        const raw = await session.getAvailableModelsRaw()
        if (raw.length > 0) {
            cached = raw.map((model) => ({
                modelId: model.id,
                name: model.name ?? model.id,
                credits: model.credits ?? null,
                creditRate: parseCreditRate(model.credits),
                custom: isCustomModel(model),
            }))
            return cached
        }
        // 完整清单不可用时退回简化清单：只有 id 与名称，倍率与来源只能按 id 前缀推断
        const models = await session.getAvailableModels()
        cached = models.map((model) => ({
            modelId: model.modelId,
            name: model.name,
            credits: null,
            creditRate: null,
            custom: model.modelId.startsWith(CUSTOM_MODEL_PREFIX),
        }))
        return cached
    } catch {
        return []
    } finally {
        session.close()
    }
}

/**
 * 解析平台下发的额度倍率文本：形如 "x0.51 credits" / "x1.62" / "x0.00 credits"。
 * 关键约束：格式由服务端决定且并不统一（个别模型缺 credits 后缀、自定义模型为 null），
 * 取不到数字时一律返回 null 表示未知，不得回退为 0，否则会把免费模型误判成零成本。
 */
export function parseCreditRate(credits: string | null | undefined): number | null {
    if (credits === null || credits === undefined) {
        return null
    }
    const matched = /x\s*([0-9]+(?:\.[0-9]+)?)/i.exec(credits)
    if (matched === null) {
        return null
    }
    const rate = Number(matched[1])
    return Number.isFinite(rate) ? rate : null
}

/**
 * 判断是否为用户自定义模型：CLI 对自建模型给 vendor=user、tags 含 custom，id 统一带 custom-local: 前缀。
 * 关键约束：三者任一命中即视为自定义 —— 实测这些字段可能单独缺失，只认一个会让分组错位。
 */
export function isCustomModel(model: { id: string; vendor?: string; tags?: string[] }): boolean {
    if (model.id.startsWith(CUSTOM_MODEL_PREFIX)) {
        return true
    }
    if (model.vendor === 'user') {
        return true
    }
    return model.tags?.includes('custom') ?? false
}

/**
 * 归一模型名：空表示交给 CLI 默认；非空一律透传，支持填写账号可用的自定义模型 id。
 * 关键约束：id 是否有效由服务端裁决，失败时通道会转出「模型不可用」的可读提示，故此处不做清单拦截。
 */
export function resolveCodebuddyModel(model: string): string | undefined {
    const trimmed = model.trim()
    return trimmed.length === 0 ? undefined : trimmed
}
