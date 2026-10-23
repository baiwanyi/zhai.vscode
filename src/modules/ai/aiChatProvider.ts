/**
 * AI 对话 Webview 面板（宿主侧）：加载 React 构建产物，路由 ai/* 与 workflow/* 协议到对话服务与工作流路由，
 * 并把 naming/* 与写作管理协议（pressAi/* 生成类、press/workspace 与 press/open 作品类、
 * press/extract/characters 人物卡提取、press/extract/outline 大纲提取）委托给各自路由。
 * 协议：请求-响应带 reqId（shared/types/messages）；流式增量经 stream 推送，reqId 与发起请求一致；
 * 上下文增删走 ai/context*，写回走 ai/writeState / ai/setMode / ai/applyWrite，state 广播以 channel 区分
 * ai（runtime / context / writeTarget）与 workflow（路由事实，含当前作品目录）。
 * 关键约束：上下文移除与写回只接受宿主生成的 id（不接受路径与范围入参），所有 Webview 入参逐字段收窄后再用；
 * 会话协议可带 projectDir 作用域（作品目录），缺省即通用对话，作用域只用于过滤查询、不参与路径拼接；
 * 场景判定统一由 WorkflowRouter 产出，取名协议只做前缀转发，本层不解析取名条件；
 * 作品协议只放行工作台需要的读取与打开，仪表盘的作品写操作不得经此入口触达。
 */
import * as vscode from 'vscode'
import { getSelectedCodebuddyModel, listCodebuddyModels, setSelectedCodebuddyModel } from './providers/codebuddyModels'
import type { AiChatService } from './chatService'
import type { WorkflowRouter } from './workflowRouter'
import type { AiConversationMode, AiModelChoices } from '../../shared/types/aiChat'
import type { HostToWebviewMessage, StreamMessage, ToastPayload } from '../../shared/types/messages'
import type { OpenWorkflowResult, ResetWorkflowResult } from '../../shared/types/workflow'
import type { SecretsService } from '../common/secrets'
import type { ToastService } from '../common/toastService'
import type { NamingRoutes } from '../naming/namingRoutes'
import type { PressRoutes } from '../press/pressRoutes'
import { isRequestMessage } from '../../shared/types/messages'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { toSafeSegments } from '../common/storagePath'
import { WEBVIEW_ALLOWED_COMMANDS } from '../common/webviewCommands'
import { buildWebviewHtml } from '../common/webviewHtml'

/** ai/send 标题提示的合法长度上限：超出视为异常入参，直接忽略 */
const MAX_TITLE_HINT_LENGTH = 32
/** ai/draft 草稿长度上限：输入框正文远小于此值，超出截断避免异常载荷占用内存 */
const MAX_DRAFT_LENGTH = 20_000
/** ai/draft 命令 id 长度上限：只存短标识，恢复时由前端按命令表再校验 */
const MAX_COMMAND_ID_LENGTH = 32
/** 模型 id 长度上限：CLI 模型 id 远短于此值，超出视为异常载荷 */
const MAX_MODEL_ID_LENGTH = 64
/** 会话作用域长度上限：作品目录形如 press/{作品名}，远短于此值，超出视为异常载荷 */
const MAX_SCOPE_LENGTH = 160

/**
 * 写作管理工作台可用的作品协议：读取、打开、人物卡与大纲提取，与仪表盘的作品写操作分开登记。
 * 两种提取都只读已落盘的 _import 素材（缺失时先补跑本地抽取），不修改正文、人物文档与大纲文档。
 */
const PRESS_WORKSPACE_METHODS: ReadonlySet<string> = new Set([
    'press/workspace',
    'press/open',
    'press/extract/characters',
    'press/extract/outline',
    'press/extract/setting',
    'press/apply',
    'press/semantic/run',
    'press/semantic/cancel',
])

export class AiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewId = 'zhai.workflow'

    /** 已解析的视图实例，用于推送流式增量与运行时变更 */
    private readonly views = new Set<vscode.WebviewView>()
    private readonly disposables: vscode.Disposable[] = []

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly service: AiChatService,
        private readonly workflowRouter: WorkflowRouter,
        private readonly naming: NamingRoutes,
        private readonly press: PressRoutes,
        private readonly secrets: SecretsService,
        private readonly state: vscode.Memento,
        private readonly toast: ToastService,
    ) {
        this.disposables.push(
            service.onStream((message) => this.broadcast(message)),
            service.onRuntimeChanged(() => this.broadcastRuntimeChanged()),
            service.onContextChanged(() => this.broadcastContextChanged()),
            service.onWriteStateChanged(() => this.broadcastWriteStateChanged()),
            workflowRouter.onChanged(() => this.broadcastWorkflowChanged()),
            toast.onToast((payload) => this.broadcastToast(payload)),
        )
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        // 存储根加入资源白名单：角色设定图落盘后需要经 asWebviewUri 供 img 加载
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'), resolveStorageRoot()],
        }
        void this.renderHtml(webviewView)
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => void this.handleMessage(webviewView, message),
            this,
        )
        this.views.add(webviewView)
        this.toast.attach()
        webviewView.onDidDispose(() => {
            this.views.delete(webviewView)
            this.toast.detach()
        }, this)
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
            const result = await this.invoke(method, payload, reqId, view)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code: method, message: text } })
        }
    }

    private async invoke(method: string, payload: unknown, reqId: string, view: vscode.WebviewView): Promise<unknown> {
        switch (method) {
            case 'ai/session': {
                return this.service.getOrCreateSession(readScopePayload(payload, 'ai/session'))
            }
            case 'ai/newSession': {
                return this.service.createSession(readScopePayload(payload, 'ai/newSession'))
            }
            case 'ai/sessions': {
                return this.service.listSessions(readScopePayload(payload, 'ai/sessions'))
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
            case 'ai/models': {
                return this.listModels()
            }
            case 'ai/selectModel': {
                return this.selectModel(payload)
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
                const { conversationId, content, applyPolicy, titleHint } = readSendPayload(payload)
                return this.service.send(reqId, conversationId, content, applyPolicy, titleHint)
            }
            case 'ai/draft': {
                const { conversationId, input, commandId } = readDraftPayload(payload)
                this.service.setDraft(conversationId, { input, commandId })
                return {}
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
                if (method.startsWith('naming/')) {
                    return this.naming.handle(method, payload)
                }
                if (method.startsWith('pressAi/') || PRESS_WORKSPACE_METHODS.has(method)) {
                    return this.press.handle(
                        method,
                        payload,
                        (uri) => view.webview.asWebviewUri(uri).toString(),
                        (progress) => this.post(view, { type: 'state', channel: 'press-semantic', payload: progress }),
                    )
                }
                throw new Error(`未知的协议方法：${method}`)
        }
    }

    /** 模型清单与当前选择：激活时已后台预热缓存，缓存为空（未登录或预热未完成）时此处现拉一次 */
    private async listModels(): Promise<AiModelChoices> {
        const models = await listCodebuddyModels(this.secrets)
        return { current: getSelectedCodebuddyModel(), options: models }
    }

    /**
     * 选择模型：手动输入走宿主输入框（webview 无原生输入框），选完写 globalState 并广播运行时变更。
     * 关键约束：只接受 modelId 字符串与 manual 标记，写入前截断长度，避免异常载荷进入 globalState。
     */
    private async selectModel(payload: unknown): Promise<{ modelId: string; changed: boolean }> {
        const selection = readModelSelectionPayload(payload)
        let modelId = selection.modelId
        if (selection.manual) {
            const input = await vscode.window.showInputBox({
                title: '输入 CodeBuddy 模型 id',
                prompt: '填写账号可用的模型 id，留空表示交给 CLI 默认',
                placeHolder: '例如 deepseek-v4.1-flash',
                ignoreFocusOut: true,
            })
            if (input === undefined) {
                return { modelId: getSelectedCodebuddyModel(), changed: false }
            }
            modelId = input.trim().slice(0, MAX_MODEL_ID_LENGTH)
        }
        await setSelectedCodebuddyModel(this.state, modelId)
        this.service.notifyRuntimeChanged()
        logger.info(`CodeBuddy 模型已设为 ${modelId.length > 0 ? modelId : '默认'}`)
        return { modelId, changed: true }
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

    /** 广播操作反馈：前端用 sonner 统一呈现，替代面板内的内联错误文本 */
    private broadcastToast(payload: ToastPayload): void {
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'toast', payload })
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

/**
 * 校验会话作用域入参（可选）：缺省或空串表示通用对话，不属于任何作品。
 * 关键约束：作用域只作查询过滤条件，仍按路径片段规则拒绝上跳、盘符与反斜杠，长度超限视为异常载荷。
 */
function readScopePayload(payload: unknown, method: string): string | null {
    if (payload === undefined || payload === null) {
        return null
    }
    if (typeof payload !== 'object') {
        throw new Error(`${method} 参数类型不正确`)
    }
    const raw = (payload as { projectDir?: unknown }).projectDir
    if (raw === undefined || raw === null) {
        return null
    }
    if (typeof raw !== 'string') {
        throw new Error(`${method} 参数类型不正确`)
    }
    const value = raw.trim()
    if (value.length === 0) {
        return null
    }
    if (value.length > MAX_SCOPE_LENGTH) {
        throw new Error(`${method} 作用域过长`)
    }
    return toSafeSegments(value, '对话作用域').join('/')
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
 * applyPolicy 缺省按 replace 处理（写作模式下用户直接输入也允许写回），report 仅由「校对」命令传入。
 * titleHint 为展示用短标题（命令名称），仅用于会话命名，超长或空值一律忽略。
 */
function readSendPayload(payload: unknown): {
    conversationId: string
    content: string
    applyPolicy: 'replace' | 'report'
    titleHint: string | null
} {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/send 缺少参数')
    }
    const value = payload as {
        conversationId?: unknown
        content?: unknown
        applyPolicy?: unknown
        titleHint?: unknown
    }
    if (typeof value.conversationId !== 'string' || typeof value.content !== 'string') {
        throw new Error('ai/send 参数类型不正确')
    }
    const titleHint = typeof value.titleHint === 'string' ? value.titleHint.trim() : ''
    return {
        conversationId: value.conversationId,
        content: value.content,
        applyPolicy: value.applyPolicy === 'report' ? 'report' : 'replace',
        titleHint: titleHint.length > 0 && titleHint.length <= MAX_TITLE_HINT_LENGTH ? titleHint : null,
    }
}

/** 校验 ai/draft 入参：只接受未发送正文与命令 id，超长截断，避免异常载荷占用内存 */
function readDraftPayload(payload: unknown): {
    conversationId: string
    input: string
    commandId: string | null
} {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/draft 缺少参数')
    }
    const value = payload as { conversationId?: unknown; input?: unknown; commandId?: unknown }
    if (typeof value.conversationId !== 'string' || typeof value.input !== 'string') {
        throw new Error('ai/draft 参数类型不正确')
    }
    const commandId =
        typeof value.commandId === 'string' &&
        value.commandId.length > 0 &&
        value.commandId.length <= MAX_COMMAND_ID_LENGTH
            ? value.commandId
            : null
    return {
        conversationId: value.conversationId,
        input: value.input.length > MAX_DRAFT_LENGTH ? value.input.slice(0, MAX_DRAFT_LENGTH) : value.input,
        commandId,
    }
}

/** 校验 ai/selectModel 入参：只取字符串 modelId 与布尔 manual，长度超限截断 */
function readModelSelectionPayload(payload: unknown): { modelId: string; manual: boolean } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/selectModel 缺少参数')
    }
    const { modelId, manual } = payload as { modelId?: unknown; manual?: unknown }
    if (modelId !== undefined && typeof modelId !== 'string') {
        throw new Error('ai/selectModel 参数类型不正确')
    }
    const value = typeof modelId === 'string' ? modelId.trim().slice(0, MAX_MODEL_ID_LENGTH) : ''
    return { modelId: value, manual: manual === true }
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
