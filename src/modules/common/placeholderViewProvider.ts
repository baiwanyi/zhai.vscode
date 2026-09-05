/**
 * 占位 Webview 视图提供器：为主侧栏「工作区」占位视图渲染轻量占位页。
 * 复用：基于 VS Code 原生 WebviewViewProvider 接口，仅输出静态占位 HTML，无需后端数据。
 * 注意：设置 CSP 并禁用脚本，内容固定不接收外部消息，符合扩展安全规范。
 */
import * as vscode from 'vscode'

export class PlaceholderWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.placeholderView'

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = { enableScripts: false }
        webviewView.webview.html = this.render()
    }

    private render(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="padding:12px;color:#888;font-family:sans-serif;">
    <p>暂无内容，敬请期待。</p>
</body>
</html>`
    }
}
