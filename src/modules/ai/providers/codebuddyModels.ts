/**
 * CodeBuddy 可用模型清单与当前选择：拉取账号支持的模型并缓存，同时把面板菜单选中的模型持久化到 globalState。
 * 复用约定：经 SDK createSession 的 getAvailableModelsRaw 取完整清单（含额度倍率 credits），
 * 站点与凭证沿用 codebuddySite 的映射；完整清单不可用时退回 getAvailableModels 的简化清单；
 * 关键约束：清单拉取需拉起 CLI 子进程（数秒）且要求已登录，失败一律降级为空列表、不阻断激活；
 * 选中值以内存副本供各通道同步读取，写入时才落 globalState —— 配置项已移除，面板菜单是唯一入口；
 * 额度倍率为平台下发文本，解析不出数值时记 null 表示未知，不得回退为 0。
 * 清单只含语言模型，文生图模型由服务端产品配置决定，不予枚举。
 * 关键约束：上下文窗口只在完整清单里下发（defaultLength / supportedLengths / maxInputTokens 三处兜底），
 * 简化清单与缓存未就绪时一律记 0 表示未知，由展示层决定不显示占比；
 * 上下文档位另存一份用户选择（0 表示跟随模型默认），取值必须按当前模型的可选档位裁决后才下发。
 */
import { tmpdir } from 'node:os'
import { unstable_v2_createSession } from '@tencent-ai/agent-sdk'
import { getZhaiConfig } from '@modules/common/config'
import type { SecretsService } from '@modules/common/secrets'
import type { AiReasoningEffort } from '@shared/types/aiChat'
import { isAiReasoningEffort } from '@shared/types/aiChat'
import { buildCodebuddyEnv } from './codebuddySite'
import type { RawLanguageModel } from '@tencent-ai/agent-sdk'
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
    /** 是否为平台默认模型：Auto（空 id）时据此取窗口与档位 */
    isDefault: boolean
    /** 模型默认上下文档位（token），0 表示平台未下发 */
    contextWindowTokens: number
    /** 该模型支持的可选上下文档位（升序）；空数组表示平台未下发 */
    contextWindowOptions: number[]
}

/** 自定义模型 id 前缀：CLI 把用户自建模型统一挂在该前缀下 */
const CUSTOM_MODEL_PREFIX = 'custom-local:'

/** 模型选择的持久化键 */
const MODEL_STATE_KEY = 'ai.codebuddyModel'
/** 上下文档位选择的持久化键 */
const CONTEXT_WINDOW_STATE_KEY = 'ai.codebuddyContextWindow'
/** 推理强度选择的持久化键 */
const EFFORT_STATE_KEY = 'ai.codebuddyEffort'

let cached: CodebuddyModelOption[] = []
let inflight: Promise<CodebuddyModelOption[]> | null = null
/** 已选模型的内存副本：各通道同步读取，避免每次穿透 globalState */
let activeModel = ''
/** 已选上下文档位：0 表示跟随模型默认，各通道同步读取 */
let activeContextWindow = 0
/** 已选推理强度：null 表示跟随模型默认，各通道同步读取 */
let activeEffort: AiReasoningEffort | null = null

/** 激活时从 globalState 载入已选模型、档位与推理强度 */
export function hydrateSelectedModel(state: Memento): void {
    activeModel = state.get<string>(MODEL_STATE_KEY, '') ?? ''
    const stored = state.get<number>(CONTEXT_WINDOW_STATE_KEY, 0) ?? 0
    activeContextWindow = Number.isFinite(stored) && stored > 0 ? Math.trunc(stored) : 0
    const effort = state.get<string>(EFFORT_STATE_KEY, '')
    // 白名单外的历史值一律按「跟随模型默认」处理，不把脏值下发给 SDK
    activeEffort = isAiReasoningEffort(effort) ? effort : null
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
 * 按模型 id 取默认上下文档位（token）：清单未命中、Auto 空 id 或平台未下发时返回 0 表示未知。
 * 关键约束：不得用 ai.maxContextTokens（历史裁剪预算）兜底，二者口径完全不同，混用会给出假占比。
 */
export function readModelContextWindow(modelId: string): number {
    return findModelOption(modelId)?.contextWindowTokens ?? 0
}

/** 按模型 id 取可选档位：清单未命中或平台未下发时返回空数组 */
export function getContextWindowOptions(modelId: string): number[] {
    return findModelOption(modelId)?.contextWindowOptions ?? []
}

/**
 * 按模型 id 定位清单项：Auto（空 id）落到平台默认模型，其余按 id 精确匹配。
 * 关键约束：只有窗口与档位允许走默认模型兜底 —— 额度倍率仍按 id 精确匹配，
 * Auto 下的真实路由模型未知，用默认模型的倍率记账会给出错误成本。
 */
function findModelOption(modelId: string): CodebuddyModelOption | undefined {
    const target = modelId.trim()
    return target.length > 0 ? cached.find((item) => item.modelId === target) : cached.find((item) => item.isDefault)
}

/** 当前选择的档位：0 表示跟随模型默认，供运行时信息与菜单回显 */
export function getSelectedContextWindow(): number {
    return activeContextWindow
}

/** 写入档位选择：0 或非法值一律按「跟随模型默认」处理 */
export async function setSelectedContextWindow(state: Memento, tokens: number): Promise<void> {
    activeContextWindow = Number.isFinite(tokens) && tokens > 0 ? Math.trunc(tokens) : 0
    await state.update(CONTEXT_WINDOW_STATE_KEY, activeContextWindow)
}

/** 当前推理强度：null 表示跟随模型默认，供运行时信息与菜单回显 */
export function getSelectedEffort(): AiReasoningEffort | null {
    return activeEffort
}

/** 写入推理强度：null 表示恢复默认，非白名单值同样按默认处理，不把脏值下发给 SDK */
export async function setSelectedEffort(state: Memento, effort: AiReasoningEffort | null): Promise<void> {
    activeEffort = isAiReasoningEffort(effort) ? effort : null
    await state.update(EFFORT_STATE_KEY, activeEffort ?? '')
}

/**
 * 解析本轮要下发的上下文档位：0 表示不设置、跟随模型默认。
 * 关键约束：只有落在当前模型可选档位内才下发 —— CLI 的 set_config 只校验正整数、不校验档位，
 * 下游不认的数字会被静默忽略，与其发出一个无声失效的配置，不如回落默认并由展示层如实呈现。
 */
export function resolveContextWindow(modelId: string): number {
    return pickContextWindow(activeContextWindow, getContextWindowOptions(modelId))
}

/**
 * 档位裁决的纯函数形态：选择值必须是正整数且落在可选档位内，否则一律 0（跟随模型默认）。
 * 独立性便于单测覆盖边界，避免测试反向依赖清单缓存。
 */
export function pickContextWindow(selected: number, options: number[]): number {
    if (!Number.isFinite(selected) || selected <= 0) {
        return 0
    }
    const value = Math.trunc(selected)
    return options.includes(value) ? value : 0
}

/**
 * 从完整清单提取默认上下文档位：defaultLength 优先，其次最大支持档位，最后退回模型输入上限。
 * 关键约束：三处都可能缺失或为 0，取不到数字时返回 0 表示未知，不得给一个猜测值。
 */
export function readContextWindowTokens(model: RawLanguageModel): number {
    const declared = model.contextWindow?.defaultLength
    if (typeof declared === 'number' && declared > 0) {
        return declared
    }
    const supported = model.contextWindow?.supportedLengths
    const longest = supported !== undefined && supported.length > 0 ? supported[supported.length - 1] : undefined
    if (typeof longest === 'number' && longest > 0) {
        return longest
    }
    const inputLimit = model.maxInputTokens
    return typeof inputLimit === 'number' && inputLimit > 0 ? inputLimit : 0
}

/** 从完整清单提取可选档位：去重升序，非法值与 0 直接丢弃 */
export function readContextWindowOptions(model: RawLanguageModel): number[] {
    const supported = model.contextWindow?.supportedLengths
    if (supported === undefined) {
        return []
    }
    const valid = supported.filter((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)
    return [...new Set(valid)].sort((left, right) => left - right)
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
                isDefault: model.isDefault === true,
                contextWindowTokens: readContextWindowTokens(model),
                contextWindowOptions: readContextWindowOptions(model),
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
            isDefault: false,
            // 简化清单不含模型能力字段，窗口与档位只能留空，展示层据此不显示占比与档位选择
            contextWindowTokens: 0,
            contextWindowOptions: [],
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
