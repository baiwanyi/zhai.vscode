/**
 * 全局搜索 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到索引与检索服务。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应统一回传 reqId 匹配。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type Database from 'better-sqlite3'
import { isRequestMessage } from '../../shared/types/messages'
import type { HostToWebviewMessage } from '../../shared/types/messages'
import type { IndexService } from './indexer/indexService'
import { searchFiles } from './db/indexRepository'
import { getZhaiConfig } from './config'
import { logger } from './logger'

export class SearchPanelViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.searchPanel'

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly db: Database.Database,
        private readonly indexService: IndexService,
    ) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
        }
        void this.renderHtml(webviewView)
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => this.handleMessage(webviewView, message),
            this,
        )
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        const distDir = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
        try {
            const template = await fs.readFile(path.join(distDir.fsPath, 'index.html'), 'utf-8')
            const assetUri = (relative: string): vscode.Uri =>
                webviewView.webview.asWebviewUri(vscode.Uri.joinPath(distDir, relative))
            // 注入 CSP 与资源基址，占位符与 vite 构建产物中的相对路径对应
            const html = template
                .replace(/(src|href)="\.\/assets\//g, `$1="${assetUri('assets').toString(true)}/`)
                .replace(
                    '</head>',
                    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webviewView.webview.cspSource}; style-src ${webviewView.webview.cspSource} 'unsafe-inline'; img-src ${webviewView.webview.cspSource} data:;"></head>`,
                )
            webviewView.webview.html = html
        } catch (error) {
            webviewView.webview.html = `<html><body><h3>Zhai</h3><p>Webview 资源缺失，请先执行 pnpm run compile（${String(error)}）</p></body></html>`
            logger.error('Webview 资源加载失败', error)
        }
    }

    private handleMessage(view: vscode.WebviewView, message: unknown): void {
        if (!isRequestMessage(message)) {
            logger.warn(`Webview 收到非协议消息，已忽略：${JSON.stringify(message).slice(0, 100)}`)
            return
        }
        const { reqId, method, payload } = message
        try {
            const result = this.invoke(method, payload)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code: method, message: text } })
        }
    }

    private invoke(method: string, payload: unknown): unknown {
        switch (method) {
            case 'search/query': {
                const keyword = typeof payload === 'string' ? payload : ''
                return searchFiles(this.db, keyword, getZhaiConfig().searchLimit)
            }
            case 'index/status': {
                return this.indexService.getStatus()
            }
            case 'index/rebuild': {
                void this.indexService.fullRebuild()
                return { started: true }
            }
            default:
                throw new Error(`未知的协议方法：${method}`)
        }
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}
