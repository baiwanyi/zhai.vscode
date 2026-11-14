/**
 * 错误文案归一：把宿主协议错误与未知异常转成可直接展示的文本。
 * 复用约定：纯函数、零前端依赖（扩展宿主 Node 侧也会引用），不得引入 sonner / React / bridge。
 * 关键约束：带 code 的错误来自宿主协议（bridge 的 HostRequestError），本模块只做结构化读取，
 * 不 import bridge——bridge 顶层有 window 副作用，被宿主引用会把前端环境拖进扩展进程；
 * 诊断文案保留 code 前缀，用户提示文案只用 message，避免把英文原因码塞进提示条。
 */

/** 带业务原因码的错误：HostRequestError 与任何带 code 的 Error 都满足 */
interface CodedError {
    code: string
    message: string
}

/** 结构化读取 code：不依赖具体错误类，保持本模块零依赖 */
function readCodedError(cause: unknown): CodedError | null {
    if (!(cause instanceof Error) || !('code' in cause)) {
        return null
    }
    const code: unknown = (cause as { code?: unknown }).code
    return typeof code === 'string' && code.length > 0 ? { code, message: cause.message } : null
}

/** 错误文案归一：Error 取 message，其余形态兜底转字符串 */
export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 用户提示文案：只有带 code 的宿主业务错误用其 message，其余一律用调用方兜底 */
export function toHostErrorText(cause: unknown, fallback: string): string {
    const coded = readCodedError(cause)
    return coded === null ? fallback : coded.message
}

/** 诊断文案：带 code 时输出「code：message」，普通 Error 取 message，其余兜底 */
export function describeError(cause: unknown, fallback: string): string {
    const coded = readCodedError(cause)
    if (coded !== null) {
        return `${coded.code}：${coded.message}`
    }
    return cause instanceof Error ? cause.message : fallback
}
