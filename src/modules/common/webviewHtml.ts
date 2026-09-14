/**
 * Webview HTML 生成：读取 Vite 构建产物并注入 CSP 与资源 URI 重写。
 * 搜索面板与工作区两个 Webview 共用，确保构建产物可被 VS Code Webview 安全加载。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'

export async function buildWebviewHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    htmlFile: string,
): Promise<string> {
    const distDir = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
    const template = await fs.readFile(path.join(distDir.fsPath, htmlFile), 'utf-8')
    const assetBase = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'assets')).toString(true)
    // 注入 CSP 与资源基址，占位符与 vite 构建产物中的相对路径对应
    return template
        .replace(/(src|href)="\.\/assets\//g, `$1="${assetBase}/`)
        .replace(
            '</head>',
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"></head>`,
        )
}
