/**
 * 剪贴板写入封装：统一处理权限拒绝等浏览器侧失败场景。
 * 复用约定：取名结果复制与提示词复制共用同一实现，调用方据返回值决定是否提示成功。
 * 关键约束：失败返回 false 而不抛错，避免复制失败被当成业务异常中断流程。
 */

/** 写系统剪贴板：失败返回 false 交调用方提示；取名复制与提示词复制共用 */
export async function copyToClipboard(content: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(content)
        return true
    } catch {
        return false
    }
}
