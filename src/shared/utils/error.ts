/**
 * 错误处理统一出口：错误文案归一（纯函数）与 sonner toast 提示。
 * 复用约定：文案口径的函数与 toast 出口都收在本文件，页面与 hooks 只从这里引用，不再有第二个错误工具模块；
 * 操作类错误统一经 toastError 走 sonner，页面不自行渲染内联错误文本。
 * 关键约束：本文件顶层 import sonner（依赖 React 与 DOM），只能在前端 webview 引用；
 * 扩展宿主 Node 侧如需错误文案归一，须另开零依赖模块，不要引用本文件，否则会把前端环境拖进扩展进程；
 * 诊断文案保留 code 前缀，用户提示文案只用 message，避免把英文原因码塞进提示条。
 */
import { toast } from 'sonner'

/** 带业务原因码的错误：HostRequestError 与任何带 code 的 Error 都满足 */
interface CodedError {
    code: string
    message: string
}

/** 结构化读取 code：不依赖具体错误类，避免为读一个字段引入 bridge */
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

/**
 * 界面错误详情兜底：null 与空白串都视为「未给详情」，返回可展示文案。
 * 与 toErrorText 的分工：toErrorText 归一异常对象，本函数归一「即将渲染到界面」的详情串。
 */
export function toErrorDetail(error: string | null, fallback = '宿主未返回错误详情'): string {
    return error === null || error.trim() === '' ? fallback : error
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

/** 统一错误提示：文案口径与 toErrorText 一致，避免内联三元在各页面散落 */
export function toastError(cause: unknown): void {
    toast.error(toErrorText(cause))
}
