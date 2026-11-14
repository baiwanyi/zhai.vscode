/**
 * 剪贴板写入封装：统一处理权限拒绝等浏览器侧失败场景。
 * 复用约定：取名结果复制与提示词复制共用同一实现，调用方据返回值决定是否提示成功；
 * copyWithToast 收口「写入 + 成功/失败提示」这条最常见路径，成功文案由调用方给、失败文案统一。
 * 关键约束：失败返回 false 而不抛错，避免复制失败被当成业务异常中断流程；
 * copyWithToast 依赖 sonner，仅限 webview 侧使用，宿主模块只可引 copyToClipboard。
 */
import { toast } from 'sonner'

/** 写系统剪贴板：失败返回 false 交调用方提示；取名复制与提示词复制共用 */
export async function copyToClipboard(content: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(content)
        return true
    } catch {
        return false
    }
}

/** 复制并提示结果：成功文案由调用方给，失败统一一句；需要按钮态反馈的场景请直接用 copyToClipboard */
export async function copyWithToast(content: string, successMessage: string): Promise<boolean> {
    const isCopied = await copyToClipboard(content)
    if (isCopied) {
        toast.success(successMessage)
        return true
    }
    toast.error('复制失败，请检查剪贴板权限')
    return false
}
