/**
 * 工作区 Webview 视图提供器：加载 Vite 构建的 React 产物，渲染工作区面板。
 * 与搜索面板共用 buildWebviewHtml 注入 CSP 与资源 URI 重写，确保由 Vite 构建托管。
 */
import * as vscode from 'vscode'
import { buildWebviewHtml } from './webviewHtml'

export class PlaceholderWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.placeholderView'

    public constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
        }
        void this.renderHtml(webviewView)
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        try {
            webviewView.webview.html = await buildWebviewHtml(webviewView.webview, this.extensionUri, 'workspace.html')
        } catch (error) {
            webviewView.webview.html = `<html><body><h3>Zhai</h3><p>Webview 资源缺失，请先执行 pnpm run compile（${String(error)}）</p></body></html>`
        }
    }
}
