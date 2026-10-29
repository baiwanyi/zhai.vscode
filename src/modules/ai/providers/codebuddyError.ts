/**
 * CodeBuddy 失败归类：把 SDK 的失败结果归纳成带分类码的错误，供文本与图像两个通道统一转成可执行提示。
 * 复用约定：分类码只描述「用户能做什么」，提示文案集中在本模块，通道不再各写一份正则与措辞。
 * 关键约束：当前 SDK（0.3.288）的 result 只有 subtype 与 errors 文本，没有 errors_info.category，
 * 因此 subtype 是一级依据，auth 与模型不可用只能按文案兜底；文案命中不得覆盖 subtype 已确定的分类。
 */
import { getZhaiConfig } from '@modules/common/config'
import { CODEBUDDY_SITE_LABELS } from './codebuddySite'

/** 失败分类：每个分类对应一条可直接照做的提示 */
export type CodebuddyErrorCode = 'auth' | 'model' | 'budget' | 'max_turns' | 'network' | 'unknown'

/** 带分类码的通道错误：上层据此决定提示文案，不再解析 Error.message */
export class CodebuddyError extends Error {
    public constructor(
        public readonly code: CodebuddyErrorCode,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options)
        this.name = 'CodebuddyError'
    }
}

/** 文案兜底：只在 subtype 无法区分时使用，正则仅覆盖最常见、可给出明确出路的两类 */
const AUTH_PATTERN = /authentication required|please (use|run) \/login/i
const MODEL_PATTERN = /service info not found|supported models for your account/i
const NETWORK_PATTERN = /econnreset|etimedout|enotfound|socket hang up|network error/i

/**
 * 按失败结果归类：subtype 优先，errors 文本兜底。
 * 关键约束：max_turns 与 max_budget 已由 subtype 明确，不再走文案判断，避免措辞变化导致漏判。
 */
export function classifyResultFailure(subtype: string, errors: readonly string[] | undefined): CodebuddyErrorCode {
    if (subtype === 'error_max_turns') {
        return 'max_turns'
    }
    if (subtype === 'error_max_budget_usd') {
        return 'budget'
    }
    const text = errors?.join('；') ?? ''
    if (AUTH_PATTERN.test(text)) {
        return 'auth'
    }
    if (MODEL_PATTERN.test(text)) {
        return 'model'
    }
    if (NETWORK_PATTERN.test(text)) {
        return 'network'
    }
    return 'unknown'
}

/** 分类 → 提示文案；modelLabel 仅在模型分类下使用 */
function describe(code: CodebuddyErrorCode, modelLabel: string): string | null {
    switch (code) {
        case 'auth':
            return `尚未登录 CodeBuddy（${CODEBUDDY_SITE_LABELS[getZhaiConfig().aiCodebuddySite]}）：请执行「宅写作：登录 CodeBuddy」后重试`
        case 'model':
            return `CodeBuddy 模型不可用：${modelLabel}不在当前账号的可用列表，请在 AI 面板的模型菜单中重新选择（或打开「自动」）`
        case 'budget':
            return 'CodeBuddy 额度不足：请前往 CodeBuddy 网页查看套餐与积分余额后重试'
        case 'max_turns':
            return 'CodeBuddy 工具轮次已用尽，请重试'
        case 'network':
            return 'CodeBuddy 网络异常：请检查网络或代理后重试'
        default:
            return null
    }
}

/**
 * 把任意异常转成可执行提示。
 * 关键约束：已带分类码的错误优先按分类出文案；其余（CLI 启动失败、鉴权失败等未归类的异常）
 * 仍按文案兜底一次，兜不住就原样抛出，不吞掉原始信息。
 */
export function toReadableCodebuddyError(error: unknown, model?: string): Error {
    const modelLabel = model !== undefined && model.length > 0 ? `「${model}」` : '当前模型'
    if (error instanceof CodebuddyError) {
        const text = describe(error.code, modelLabel)
        return text === null ? error : new Error(text, { cause: error })
    }
    const message = error instanceof Error ? error.message : String(error)
    if (AUTH_PATTERN.test(message)) {
        return new Error(describe('auth', modelLabel) ?? message, { cause: error })
    }
    if (MODEL_PATTERN.test(message)) {
        return new Error(describe('model', modelLabel) ?? message, { cause: error })
    }
    return error instanceof Error ? error : new Error(message)
}
