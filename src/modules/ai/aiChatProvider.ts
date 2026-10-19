/**
 * AI 对话 Webview 面板（宿主侧）：加载 React 构建产物，路由 ai/* 与 workflow/* 协议到对话服务与工作流路由。
 * 协议：请求-响应带 reqId（shared/types/messages）；流式增量经 stream 推送，reqId 与发起请求一致；
 * 上下文增删走 ai/context*，写回走 ai/writeState / ai/setMode / ai/applyWrite，state 广播以 channel 区分
 * ai（runtime / context / writeTarget）与 workflow（路由事实）。
 * 关键约束：上下文移除与写回只接受宿主生成的 id（不接受路径与范围入参），所有 Webview 入参逐字段收窄后再用；
 * 场景判定统一由 WorkflowRouter 产出，本层只做转发，避免两处口径分叉。
 */
import * as vscode from 'vscode'
import type { AiChatService } from './chatService'
import type { WorkflowRouter } from './workflowRouter'
import type { AiConversationMode } from '../../shared/types/aiChat'
import type { HostToWebviewMessage, StreamMessage } from '../../shared/types/messages'
import type { OpenWorkflowResult, ResetWorkflowResult } from '../../shared/types/workflow'
import { isRequestMessage } from '../../shared/types/messages'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { logger } from '../common/logger'
import { WEBVIEW_ALLOWED_COMMANDS } from '../common/webviewCommands'
import { buildWebviewHtml } from '../common/webviewHtml'

export class AiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewId = 'zhai.workflow'

    /** 已解析的视图实例，用于推送流式增量与运行时变更 */
    private readonly views = new Set<vscode.WebviewView>()
    private readonly disposables: vscode.Disposable[] = []

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly service: AiChatService,
        private readonly workflowRouter: WorkflowRouter,
    ) {
        this.disposables.push(
            service.onStream((message) => this.broadcast(message)),
            service.onRuntimeChanged(() => this.broadcastRuntimeChanged()),
            service.onContextChanged(() => this.broadcastContextChanged()),
            service.onWriteStateChanged(() => this.broadcastWriteStateChanged()),
            workflowRouter.onChanged(() => this.broadcastWorkflowChanged()),
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
            webviewView.webview.html = await buildWebviewHtml(
                webviewView.webview,
                this.extensionUri,
                'workflow/index.html',
            )
        } catch (error) {
            webviewView.webview.html = `<html><body><h3>宅写作</h3><p>Webview 资源缺失，请先执行 pnpm run compile（${String(error)}）</p></body></html>`
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
            case 'workflow/state': {
                return this.workflowRouter.getContext()
            }
            case 'workflow/open': {
                return this.openWorkflow(payload)
            }
            case 'workflow/reset': {
                return this.resetWorkflow()
            }
            case 'ai/writeState': {
                return this.service.getWriteState()
            }
            case 'ai/setMode': {
                return { mode: this.service.setMode(readModePayload(payload)) }
            }
            case 'ai/applyWrite': {
                return this.service.applyWrite(readApplyPayload(payload))
            }
            case 'ai/send': {
                const { conversationId, content, applyPolicy } = readSendPayload(payload)
                return this.service.send(reqId, conversationId, content, applyPolicy)
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

    /** 通知前端重新拉取写回状态（模式切换、生成完成或写回成功后） */
    private broadcastWriteStateChanged(): void {
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'ai', payload: { kind: 'writeTarget' } })
        }
    }

    /** 广播路由事实（场景切换或模块选定变更）：面板据此重新解析并换页 */
    private broadcastWorkflowChanged(): void {
        if (this.views.size === 0) {
            return
        }
        const context = this.workflowRouter.getContext()
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'workflow', payload: context })
        }
    }

    /** 选定模块：初始页与仪表盘入口共用同一状态，结果由广播下发，本层不判定场景 */
    private openWorkflow(payload: unknown): OpenWorkflowResult {
        if (!isOpenWorkflowRequest(payload)) {
            throw new Error('workflow/open 参数非法：module 须为非空模块键')
        }
        this.workflowRouter.selectModule(payload.module)
        return { opened: true }
    }

    /** 清除模块选定：面板回到初始页 */
    private resetWorkflow(): ResetWorkflowResult {
        this.workflowRouter.clearModule()
        return { cleared: true }
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

/**
 * 校验 ai/send 入参：Webview 侧数据不可信，逐字段收窄后再落库。
 * applyPolicy 缺省按 replace 处理（写作模式下用户直接输入也允许写回），report 仅由「找错别字」命令传入。
 */
function readSendPayload(payload: unknown): {
    conversationId: string
    content: string
    applyPolicy: 'replace' | 'report'
} {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/send 缺少参数')
    }
    const value = payload as { conversationId?: unknown; content?: unknown; applyPolicy?: unknown }
    if (typeof value.conversationId !== 'string' || typeof value.content !== 'string') {
        throw new Error('ai/send 参数类型不正确')
    }
    return {
        conversationId: value.conversationId,
        content: value.content,
        applyPolicy: value.applyPolicy === 'report' ? 'report' : 'replace',
    }
}

/** 校验 ai/setMode 入参：只接受两个合法模式值 */
function readModePayload(payload: unknown): AiConversationMode {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/setMode 缺少参数')
    }
    const mode = (payload as { mode?: unknown }).mode
    if (mode !== 'chat' && mode !== 'write') {
        throw new Error('ai/setMode 参数类型不正确')
    }
    return mode
}

/** 校验 ai/applyWrite 入参：只接受宿主生成的助手消息 id，不接受路径与范围（防越权写入任意位置） */
function readApplyPayload(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/applyWrite 缺少参数')
    }
    const messageId = (payload as { messageId?: unknown }).messageId
    if (typeof messageId !== 'string' || messageId.length === 0) {
        throw new Error('ai/applyWrite 参数类型不正确')
    }
    return messageId
}
