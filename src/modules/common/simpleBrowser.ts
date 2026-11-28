/**
 * 内置浏览器打开：把 VS Code Simple Browser 命令封装成宿主侧的统一入口。
 * 复用约定：所有「在编辑器内打开网页」的能力都调用本函数，不再散写 simpleBrowser.show 命令 ID；
 * 返回 boolean 表示命令是否成功下发，调用方可据此决定是否提示，命令异常在这里收敛为 false。
 * 关键约束：只接受 http/https 地址；URL 的可信度由调用方负责（固定常量或域名白名单），
 * 本函数不做业务信任判断；Simple Browser 以 iframe 渲染，目标站点可能拒绝嵌入，无法在本地预知。
 */
import * as vscode from 'vscode'

/** Simple Browser 是 VS Code 内置命令，无需扩展注册 */
const SIMPLE_BROWSER_COMMAND = 'simpleBrowser.show'

/**
 * 在 VS Code 内置浏览器打开链接。
 * 关键约束：调用方必须先完成 URL 信任校验（固定常量或域名白名单），这里只挡非 http/https 协议；
 * 命令执行失败返回 false，不抛错——打开网页失败不应打断调用方的业务流程。
 */
export async function openInSimpleBrowser(url: string): Promise<boolean> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false
    }
    try {
        await vscode.commands.executeCommand(SIMPLE_BROWSER_COMMAND, url)
        return true
    } catch {
        return false
    }
}
