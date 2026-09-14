/**
 * AI 对话 Webview 面板（宿主侧）：加载 React 构建产物，路由 ai/* 协议到对话服务。
 * 协议：请求-响应带 reqId（shared/types/messages）；流式增量经 stream 推送，reqId 与发起请求一致；
 * 上下文增删走 ai/context*，state 广播以 payload.kind 区分 runtime / context 供前端定向刷新。
 * 关键约束：上下文移除只接受宿主生成的引用 id（不接受路径入参），所有 Webview 入参逐字段收窄后再用。
 */
import * as vscode from 'vscode'
import type { AiChatService } from './chatService'
import type { HostToWebviewMessage, StreamMessage } from '../../shared/types/messages'
import { isRequestMessage } from '../../shared/types/messages'
import { logger } from '../common/logger'
import { WEBVIEW_ALLOWED_COMMANDS } from '../common/webviewCommands'
import { buildWebviewHtml } from '../common/webviewHtml'

export class AiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewId = 'zhai.aiChat'

    /** 已解析的视图实例，用于推送流式增量与运行时变更 */
    private readonly views = new Set<vscode.WebviewView>()
    private readonly disposables: vscode.Disposable[] = []

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly service: AiChatService,
    ) {
        this.disposables.push(
            service.onStream((message) => this.broadcast(message)),
            service.onRuntimeChanged(() => this.broadcastRuntimeChanged()),
            service.onContextChanged(() => this.broadcastContextChanged()),
        )
    }

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
        this.views.add(webviewView)
        webviewView.onDidDispose(() => this.views.delete(webviewView), this)
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.views.clear()
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        try {
            webviewView.webview.html = await buildWebviewHtml(webviewView.webview, this.extensionUri, 'aichat.html')
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
            const result = await this.invoke(method, payload, reqId)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code: method, message: text } })
        }
    }

    private async invoke(method: string, payload: unknown, reqId: string): Promise<unknown> {
        switch (method) {
            case 'ai/session': {
                return this.service.getOrCreateSession()
            }
            case 'ai/newSession': {
                return this.service.createSession()
            }
            case 'ai/sessions': {
                return this.service.listSessions()
            }
            case 'ai/switchSession': {
                return this.service.switchSession(readConversationIdPayload(payload, 'ai/switchSession'))
            }
            case 'ai/deleteSession': {
                return { deleted: this.service.deleteSession(readConversationIdPayload(payload, 'ai/deleteSession')) }
            }
            case 'ai/runtime': {
                return this.service.getRuntimeInfo()
            }
            case 'ai/send': {
                const { conversationId, content } = readSendPayload(payload)
                return this.service.send(reqId, conversationId, content)
            }
            case 'ai/context': {
                return this.service.getContexts()
            }
            case 'ai/context/remove': {
                return this.service.removeContext(readContextIdPayload(payload))
            }
            case 'ai/context/clear': {
                this.service.clearContexts()
                return []
            }
            case 'ai/abort': {
                return { aborted: this.service.abort() }
            }
            case 'host/command': {
                const command = typeof payload === 'string' ? payload : ''
                if (!WEBVIEW_ALLOWED_COMMANDS.has(command)) {
                    throw new Error(`未授权的宿主命令：${command}`)
                }
                void vscode.commands.executeCommand(command)
                return { executed: true }
            }
            default:
                throw new Error(`未知的协议方法：${method}`)
        }
    }

    /** 流式增量广播到全部已打开视图 */
    private broadcast(message: StreamMessage): void {
        for (const view of this.views) {
            void view.webview.postMessage(message)
        }
    }

    /** 通知前端重新拉取运行时信息（密钥增删后） */
    private broadcastRuntimeChanged(): void {
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'ai', payload: { kind: 'runtime' } })
        }
    }

    /** 通知前端重新拉取待发送上下文（编辑器右键添加或面板移除后） */
    private broadcastContextChanged(): void {
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'ai', payload: { kind: 'context' } })
        }
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}

/** 校验会话 id 入参：Webview 侧数据不可信，仅接受非空字符串 */
function readConversationIdPayload(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const value = payload as { conversationId?: unknown }
    if (typeof value.conversationId !== 'string' || value.conversationId.length === 0) {
        throw new Error(`${method} 参数类型不正确`)
    }
    return value.conversationId
}

/** 校验 ai/context/remove 入参：只接受宿主生成的引用 id，不接受路径（防越权读取任意文件） */
function readContextIdPayload(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/context/remove 缺少参数')
    }
    const value = payload as { id?: unknown }
    if (typeof value.id !== 'string' || value.id.length === 0) {
        throw new Error('ai/context/remove 参数类型不正确')
    }
    return value.id
}

/** 校验 ai/send 入参：Webview 侧数据不可信，逐字段收窄后再落库 */
function readSendPayload(payload: unknown): { conversationId: string; content: string } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/send 缺少参数')
    }
    const value = payload as { conversationId?: unknown; content?: unknown }
    if (typeof value.conversationId !== 'string' || typeof value.content !== 'string') {
        throw new Error('ai/send 参数类型不正确')
    }
    return { conversationId: value.conversationId, content: value.content }
}
