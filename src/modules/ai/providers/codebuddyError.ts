/**
 * CodeBuddy 失败归类：把 SDK 的失败结果归纳成带分类码的错误，供文本与图像两个通道统一转成可执行提示。
 * 复用约定：分类码只描述「用户能做什么」，提示文案集中在本模块，通道不再各写一份正则与措辞；
 * 文案由文本通道（./codebuddy）与图像通道（../imagegen/ai/codebuddyImageProvider）共用。
 * 关键约束：当前 SDK（0.3.288）的 result 只有 subtype 与 errors 文本，没有 errors_info.category，
 * 因此 subtype 是一级依据，auth 与模型不可用只能按文案兜底；文案命中不得覆盖 subtype 已确定的分类；
 * 工具权限被拒这类英文内部错误同样在这里转成中文，前端不对 SDK 原文做二次翻译。
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
 * 工具权限被拒的原文：SDK 会回一条英文「Permission denied for tool(s): Edit」。
 * 关键约束：工具名不进提示 —— 动作文案由前端映射，宿主再维护一份必然分叉；具体拒了哪次写在确认卡片里。
 */
const PERMISSION_DENIED_PATTERN = /permission denied for tool\(s\):/i
const PERMISSION_DENIED_TEXT = '工具调用未获批准，本轮已停止'

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

/**
 * 分类 → 提示文案；modelLabel 仅在模型分类下使用。
 * 关键约束：auth 分支里的命令标题须与 package.json 中 zhai.ai.loginCodebuddy 的
 * category（宅写作）与 title（登录 CodeBuddy）保持一致 —— 改命令名时同步此处，否则用户按提示搜不到命令。
 */
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
        if (text !== null) {
            return new Error(text, { cause: error })
        }
        // 归到 unknown 的错误也可能是英文内部文案（result.errors 里的权限拒绝），同样要转中文
        if (PERMISSION_DENIED_PATTERN.test(error.message)) {
            return new Error(PERMISSION_DENIED_TEXT, { cause: error })
        }
        return error
    }
    const message = error instanceof Error ? error.message : String(error)
    if (AUTH_PATTERN.test(message)) {
        return new Error(describe('auth', modelLabel) ?? message, { cause: error })
    }
    if (MODEL_PATTERN.test(message)) {
        return new Error(describe('model', modelLabel) ?? message, { cause: error })
    }
    // 权限拒绝：英文原文不露给用户，换成中文结果说明
    if (PERMISSION_DENIED_PATTERN.test(message)) {
        return new Error(PERMISSION_DENIED_TEXT, { cause: error })
    }
    return error instanceof Error ? error : new Error(message)
}
