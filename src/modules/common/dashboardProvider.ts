/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合与宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应统一回传 reqId 匹配。
 */
import * as vscode from 'vscode'
import { aggregateFileStats, listRecentFiles } from './db/statsRepository'
import { logger } from './logger'
import { buildWebviewHtml } from './webviewHtml'
import type { IndexService } from './indexer/indexService'
import type { DashboardStats } from '../../shared/types/dashboard'
import type { HostToWebviewMessage } from '../../shared/types/messages'
import type Database from 'better-sqlite3'
import { isRequestMessage } from '../../shared/types/messages'

/** 允许 Webview 触发的宿主命令白名单，避免任意命令被执行 */
const ALLOWED_HOST_COMMANDS = new Set(['zhai.clearIndex', 'zhai.openSettings'])

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.dashboard'

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
        webviewView.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(webviewView, message), this)
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        try {
            webviewView.webview.html = await buildWebviewHtml(webviewView.webview, this.extensionUri, 'index.html')
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
            case 'dashboard/stats': {
                return this.buildStats()
            }
            case 'index/rebuild': {
                void this.indexService.fullRebuild()
                return { started: true }
            }
            case 'host/command': {
                const command = typeof payload === 'string' ? payload : ''
                if (!ALLOWED_HOST_COMMANDS.has(command)) {
                    throw new Error(`未授权的宿主命令：${command}`)
                }
                void vscode.commands.executeCommand(command)
                return { executed: true }
            }
            default:
                throw new Error(`未知的协议方法：${method}`)
        }
    }

    /** 组装统计快照：文件级聚合来自索引库，构建状态来自索引服务 */
    private buildStats(): DashboardStats {
        const status = this.indexService.getStatus()
        return {
            ...aggregateFileStats(this.db),
            recentFiles: listRecentFiles(this.db),
            lastBuiltAt: status.lastBuiltAt,
            isRebuilding: status.isRebuilding,
        }
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}
