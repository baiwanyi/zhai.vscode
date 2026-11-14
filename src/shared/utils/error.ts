/**
 * 错误处理统一出口：错误文案归一与 sonner toast 提示。
 * 复用约定：文案口径的纯函数在 ./errorText（扩展宿主也可直接引用），本模块只补 toast 出口；
 * 操作类错误一律经 toastError 走 sonner，页面不再自行渲染内联错误文本。
 * 关键约束：本模块顶层依赖 sonner（React 与浏览器环境），Node 侧只能引用 ./errorText。
 */
import { toast } from 'sonner'
import { describeError, toErrorText, toHostErrorText } from './errorText'

export { describeError, toErrorText, toHostErrorText }

/** 统一错误提示：文案口径与 toErrorText 一致，避免内联三元在各页面散落 */
export function toastError(cause: unknown): void {
    toast.error(toErrorText(cause))
}
