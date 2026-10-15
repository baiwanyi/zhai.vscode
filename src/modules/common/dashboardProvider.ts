/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合、笔记创建与宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应按 reqId 匹配回传。
 * 关键约束：请求处理为异步流程（新建笔记需落盘 + 索引 + 打开），须 await 结果后再回包；
 * 命令入口一律经白名单校验，未登记的命令直接拒绝。
 */
import * as vscode from 'vscode'
import { aggregateFileStats, listRecentFiles } from './db/statsRepository'
import { logger } from './logger'
import { WEBVIEW_ALLOWED_COMMANDS } from './webviewCommands'
import { buildWebviewHtml } from './webviewHtml'
import type { IndexService } from './indexer/indexService'
import type { DashboardStats } from '../../shared/types/dashboard'
import type { HostToWebviewMessage } from '../../shared/types/messages'
import type Database from 'better-sqlite3'
import { isRequestMessage } from '../../shared/types/messages'
import { createAndOpenNote } from '../note/noteService'

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
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => void this.handleMessage(webviewView, message),
            this,
        )
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        try {
            webviewView.webview.html = await buildWebviewHtml(
                webviewView.webview,
                this.extensionUri,
                'dashboard/index.html',
            )
        } catch (error) {
            webviewView.webview.html = `<html><body><h3>Zhai</h3><p>Webview 资源缺失，请先执行 pnpm run compile（${String(error)}）</p></body></html>`
            logger.error('Webview 资源加载失败', error)
        }
    }

    private async handleMessage(view: vscode.WebviewView, message: unknown): Promise<void> {
        if (!isRequestMessage(message)) {
            logger.warn(`Webview 收到非协议消息，已忽略：${JSON.stringify(message).slice(0, 100)}`)
            return
        }
        const { reqId, method, payload } = message
        try {
            const result = await this.invoke(method, payload)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code: method, message: text } })
        }
    }

    private invoke(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'dashboard/stats': {
                return Promise.resolve(this.buildStats())
            }
            case 'note/create': {
                return createAndOpenNote(this.indexService)
            }
            case 'index/rebuild': {
                void this.indexService.fullRebuild()
                return Promise.resolve({ started: true })
            }
            case 'host/command': {
                const command = typeof payload === 'string' ? payload : ''
                if (!WEBVIEW_ALLOWED_COMMANDS.has(command)) {
                    throw new Error(`未授权的宿主命令：${command}`)
                }
                void vscode.commands.executeCommand(command)
                return Promise.resolve({ executed: true })
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
