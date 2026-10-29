/**
 * Webview HTML 生成：读取 Vite 构建产物并注入 CSP 与资源 URI 重写。
 * 仪表盘与 AI 对话两个 Webview 共用，确保构建产物可被 VS Code Webview 安全加载。
 * 关键约束：CSP 与 localResourceRoots 必须同时放行存储根，否则正文里的 @zhai/ 图片会被拦成 401；
 * 存储根基址以 meta 形式注入而不是内联脚本——CSP 的 script-src 不允许 inline script；
 * 同时注入存储根的文件系统路径，供引用徽章等展示层把绝对路径裁回 `@zhai\` 形式。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { STORAGE_BASE_META, STORAGE_ROOT_META } from '@shared/utils/zhaiPath'
import { resolveStorageRoot } from './config'

/** HTML 属性值转义：URL 中的 & 与引号必须转义，否则会截断属性 */
function escapeAttribute(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}

export async function buildWebviewHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    htmlFile: string,
): Promise<string> {
    const distDir = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
    const template = await fs.readFile(path.join(distDir.fsPath, htmlFile), 'utf-8')
    const assetBase = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'assets')).toString(true)
    // 存储根基址：正文 @zhai/ 引用的解析依据，与 localResourceRoots 的白名单同源
    const storageRootUri = resolveStorageRoot()
    const storageBase = escapeAttribute(webview.asWebviewUri(storageRootUri).toString(true))
    // 存储根文件系统路径：展示层用它把绝对路径裁成 @zhai 相对路径，空值由前端自行兜底
    const storageRootPath = escapeAttribute(storageRootUri.fsPath)
    // 注入 CSP 与资源基址，占位符与 vite 构建产物中的相对路径对应；子目录入口（如 aichat/aichat.html）的资源引用带 ../ 前缀
    return template
        .replace(/(src|href)="(?:\.\.?\/)*assets\//g, `$1="${assetBase}/`)
        .replace(
            '</head>',
            `<meta name="${STORAGE_BASE_META}" content="${storageBase}"><meta name="${STORAGE_ROOT_META}" content="${storageRootPath}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"></head>`,
        )
}
