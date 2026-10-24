/**
 * 错误处理统一出口：错误文案归一与 sonner toast 提示。
 * 复用约定：文案口径以 toErrorText 为唯一实现，调用方不再各自判断 Error 分支；
 * 操作类错误一律经 toastError 走 sonner，页面不再自行渲染内联错误文本。
 * 关键约束：本模块顶层依赖 sonner（React 与浏览器环境），Node 侧单测须以 mock 替换。
 */
import { toast } from 'sonner'

/** 错误文案归一：宿主协议错误以 Error 抛出，其余形态兜底转字符串 */
export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 统一错误提示：文案口径与 toErrorText 一致，避免内联三元在各页面散落 */
export function toastError(cause: unknown): void {
    toast.error(toErrorText(cause))
}
