/**
 * AI 对话 Webview 面板（宿主侧）：加载 React 构建产物，路由 ai/* 与 workflow/* 协议到对话服务与工作流路由，
 * 并把 naming/*、校对协议（proofread/*）与写作管理协议（pressAi/* 生成类、
 * press/workspace 与 press/open 作品类、press/extract/characters 人物卡提取、press/extract/outline 大纲提取）
 * 委托给各自路由。
 * 协议：请求-响应带 reqId（shared/types/messages）；流式增量经 stream 推送，reqId 与发起请求一致；
 * 上下文增删走 ai/context*；写入范围走 ai/setWriteGrant，工具审批经 ai/permissionDecision 回包
 * （本轮授权随 ai/send 的 autoApprove 下发，无常驻审批开关），写入状态走 ai/writeState，state 广播以 channel 区分
 * ai（runtime / context / writeTarget）与 workflow（路由事实，含当前作品目录）。
 * 关键约束：上下文移除与写回只接受宿主生成的 id（不接受路径与范围入参），所有 Webview 入参逐字段收窄后再用；
 * 会话协议可带 projectDir 作用域（作品目录），缺省即通用对话，作用域只用于过滤查询、不参与路径拼接；
 * 场景判定统一由 WorkflowRouter 产出，取名协议只做前缀转发，本层不解析取名条件；
 * 作品协议只放行工作台需要的读取与打开，仪表盘的作品写操作不得经此入口触达。
 */
import * as vscode from 'vscode'
import { getZhaiConfig, resolvePromptRoot, resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { SecretsService } from '@modules/common/secrets'
import { toSafeSegments } from '@modules/common/storagePath'
import type { ToastService } from '@modules/common/toastService'
import { WEBVIEW_ALLOWED_COMMANDS } from '@modules/common/webviewCommands'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import type { MediaRoutes } from '@modules/media/mediaRoutes'
import type { NamingRoutes } from '@modules/naming/namingRoutes'
import type { PressRoutes } from '@modules/press/pressRoutes'
import type { ProofreadRoutes } from '@modules/proofread/proofreadRoutes'
import type { WechatRoutes } from '@modules/wechat/wechatRoutes'
import type { AiModelChoices, AiPermissionDecision, AiReasoningEffort, AiWriteGrant } from '@shared/types/aiChat'
import { AI_REASONING_EFFORT_LABELS, isAiReasoningEffort } from '@shared/types/aiChat'
import type { AiUsageQuery } from '@shared/types/aiUsage'
import { isAiUsageModule, isAiUsageRange } from '@shared/types/aiUsage'
import type { HostToWebviewMessage, StreamMessage, ToastPayload } from '@shared/types/messages'
import { isRequestMessage } from '@shared/types/messages'
import type { OpenWorkflowResult, ResetWorkflowResult, WorkflowViewRequest } from '@shared/types/workflow'
import { isOpenWorkflowRequest } from '@shared/types/workflow'
import {
    getContextWindowOptions,
    getSelectedCodebuddyModel,
    getSelectedContextWindow,
    getSelectedEffort,
    listCodebuddyModels,
    setSelectedCodebuddyModel,
    setSelectedContextWindow,
    setSelectedEffort,
} from './providers/codebuddyModels'
import { CODEBUDDY_CREDITS_URLS } from './providers/codebuddySite'
import type { AiChatService } from './chatService'
import type { MentionService } from './mentionService'
import type { ReferenceService } from './referenceService'
import type { AiUsageService } from './usageService'
import type { WorkflowRouter } from './workflowRouter'

/** ai/send 标题提示的合法长度上限：超出视为异常入参，直接忽略 */
const MAX_TITLE_HINT_LENGTH = 32
/** ai/draft 草稿长度上限：输入框正文远小于此值，超出截断避免异常载荷占用内存 */
const MAX_DRAFT_LENGTH = 20_000
/** ai/draft 命令 id 长度上限：只存短标识，恢复时由前端按命令表再校验 */
const MAX_COMMAND_ID_LENGTH = 32
/** 模型 id 长度上限：CLI 模型 id 远短于此值，超出视为异常载荷 */
const MAX_MODEL_ID_LENGTH = 64
/** 上下文档位上限：模型窗口最大为百万级，超出视为异常载荷 */
const MAX_CONTEXT_WINDOW_TOKENS = 10_000_000
/** 会话作用域长度上限：作品目录形如 press/{作品名}，远短于此值，超出视为异常载荷 */
const MAX_SCOPE_LENGTH = 160

/**
 * 写作管理工作台可用的作品协议：读取、打开、人物卡与大纲提取、文档回写与作品快照，
 * 与仪表盘的作品写操作（press/create、press/delete* 等）分开登记。
 * 两种提取都只读已落盘的 Materials 素材（缺失时先补跑本地抽取），不修改正文、人物文档与大纲文档；
 * 四个快照方法只在 Snapshots 目录下读写，恢复时按四份文档整版或指定覆盖。
 * 关键约束：新增 press/* 路由必须同步登记本白名单，否则请求在分发层即被拒绝。
 */
const PRESS_WORKSPACE_METHODS: ReadonlySet<string> = new Set([
    'press/workspace',
    'press/open',
    'press/extract/characters',
    'press/extract/outline',
    'press/extract/setting',
    'press/apply',
    'press/snapshot/list',
    'press/snapshot/create',
    'press/snapshot/restore',
    'press/snapshot/delete',
    'press/snapshot/chapter/list',
    'press/snapshot/chapter/versions',
    'press/snapshot/chapter/capture',
    'press/snapshot/chapter/restore',
    'press/snapshot/chapter/delete',
])

export class AiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewId = 'zhai.workflow'

    /** 已解析的视图实例，用于推送流式增量与运行时变更 */
    private readonly views = new Set<vscode.WebviewView>()
    private readonly disposables: vscode.Disposable[] = []

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly service: AiChatService,
        private readonly usageService: AiUsageService,
        private readonly mention: MentionService,
        private readonly reference: ReferenceService,
        private readonly workflowRouter: WorkflowRouter,
        private readonly naming: NamingRoutes,
        private readonly press: PressRoutes,
        private readonly media: MediaRoutes,
        private readonly proofread: ProofreadRoutes,
        private readonly secrets: SecretsService,
        private readonly state: vscode.Memento,
        private readonly toast: ToastService,
        /** 公众号运营分区协议：与仪表盘共用同一份路由实例，数据源因此只有一套 */
        private readonly wechat: WechatRoutes,
    ) {
        this.disposables.push(
            service.onStream((message) => this.broadcast(message)),
            service.onRuntimeChanged(() => this.broadcastRuntimeChanged()),
            service.onContextChanged(() => this.broadcastContextChanged()),
            service.onWriteStateChanged(() => this.broadcastWriteStateChanged()),
            workflowRouter.onChanged(() => this.broadcastWorkflowChanged()),
            workflowRouter.onViewRequested((request) => this.broadcastWorkflowView(request)),
            toast.onToast((payload) => this.broadcastToast(payload)),
        )
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        // 存储根加入资源白名单：角色设定图落盘后需要经 asWebviewUri 供 img 加载
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                resolveStorageRoot(),
                // 提示词预览图可能落在词库目录设置指定的位置，须在此放行，否则 asWebviewUri 出的地址会被拒
                resolvePromptRoot(),
                // 兜底仓库内的词库目录：视图可能在配置就绪前创建，此时 resolvePromptRoot 取到默认值，
                // 而随后的资源请求按真实配置求值，两者对不上会让预览图一律 401；扩展目录内的这份词库无秘密
                vscode.Uri.joinPath(this.extensionUri, 'resources', 'prompt'),
            ],
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
            case 'ai/usage': {
                return this.usageService.list(readUsageQueryPayload(payload))
            }
            case 'ai/usage/prompt': {
                return this.usageService.readPrompt(readUsagePromptPayload(payload))
            }
            case 'ai/mention/search': {
                return { candidates: this.mention.search(readKeywordPayload(payload, 'ai/mention/search')) }
            }
            case 'ai/reference/search': {
                return { entries: await this.reference.search(readKeywordPayload(payload, 'ai/reference/search')) }
            }
            case 'ai/reference/add': {
                const target = readReferencePayload(payload)
                return this.reference.add(target.file, target.startLine)
            }
            case 'ai/reference/openDir': {
                return this.reference.openDir()
            }
            case 'ai/mention/add': {
                const target = readMentionPathPayload(payload)
                return this.mention.add(target.path, target.startLine, target.endLine)
            }
            case 'ai/models': {
                return this.listModels()
            }
            case 'ai/selectModel': {
                return this.selectModel(payload)
            }
            case 'ai/selectContextWindow': {
                return this.selectContextWindow(payload)
            }
            case 'ai/selectEffort': {
                return this.selectEffort(payload)
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
            case 'ai/setWriteGrant': {
                return { writeGrant: this.service.setWriteGrant(readWriteGrantPayload(payload)) }
            }
            case 'ai/permissionDecision': {
                const { id, decision } = readPermissionDecisionPayload(payload)
                return { resolved: this.service.resolvePermission(id, decision) }
            }
            case 'ai/send': {
                const { conversationId, content, isAutoApprove, titleHint } = readSendPayload(payload)
                return this.service.send(reqId, conversationId, content, isAutoApprove, titleHint)
            }
            case 'ai/draft': {
                const { conversationId, input, commandId } = readDraftPayload(payload)
                this.service.setDraft(conversationId, { input, commandId })
                return {}
            }
            case 'ai/enhancePrompt': {
                return this.service.enhancePrompt(payload)
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
            case 'host/openExternal': {
                return this.openCreditsPage(payload)
            }
            default:
                if (method.startsWith('proofread/')) {
                    return this.proofread.handle(method, payload, (completed, total) =>
                        this.post(view, {
                            type: 'state',
                            channel: 'proofread',
                            payload: { kind: 'progress', batch: completed, total },
                        }),
                    )
                }
                if (method.startsWith('naming/')) {
                    return this.naming.handle(method, payload)
                }
                if (method.startsWith('media/')) {
                    return this.media.handle(method, payload, (uri) => view.webview.asWebviewUri(uri).toString())
                }
                // 公众号运营分区与应用内仪表盘共用同一份路由：两个面板各自发起请求，数据源只有一套
                if (method.startsWith('wechat/')) {
                    // 推送阶段经 state 通道回投给本面板，与仪表盘同一份载荷结构
                    return this.wechat.handle(method, payload, (progress) => {
                        this.post(view, { type: 'state', channel: 'wechat', payload: progress })
                    })
                }
                if (method.startsWith('pressAi/') || PRESS_WORKSPACE_METHODS.has(method)) {
                    return this.press.handle(
                        method,
                        payload,
                        (uri) => view.webview.asWebviewUri(uri).toString(),
                        (progress) => this.post(view, { type: 'state', channel: 'press-semantic', payload: progress }),
                        // 出图阶段单独走 imagegen 通道：与语义归纳的载荷结构不同，前端按通道区分
                        (progress) => this.post(view, { type: 'state', channel: 'imagegen', payload: progress }),
                    )
                }
                throw new Error(`未知的协议方法：${method}`)
        }
    }

    /**
     * 打开积分余额页：余额构成（套餐赠送、平台奖励）只在 CodeBuddy 网页端可见，CLI 与本地记录都不含余额，
     * 因此这里只做按站点跳转。关键约束：目标由宿主按当前站点的固定表解析，前端只能传固定标识，
     * 不接受任意 URL，避免 Webview 借本协议打开不可信地址。
     */
    private async openCreditsPage(payload: unknown): Promise<{ opened: boolean }> {
        if (payload !== 'credits') {
            throw new Error('host/openExternal 参数不正确')
        }
        const site = getZhaiConfig().aiCodebuddySite
        return { opened: await vscode.env.openExternal(vscode.Uri.parse(CODEBUDDY_CREDITS_URLS[site])) }
    }

    /** 模型清单与当前选择：激活时已后台预热缓存，缓存为空（未登录或预热未完成）时此处现拉一次 */
    private async listModels(): Promise<AiModelChoices> {
        const models = await listCodebuddyModels(this.secrets)
        return {
            current: getSelectedCodebuddyModel(),
            contextWindow: getSelectedContextWindow(),
            reasoningEffort: getSelectedEffort(),
            options: models,
        }
    }

    /**
     * 选择推理强度：null 表示跟随模型默认。
     * 关键约束：只接受白名单取值，非法值直接拒绝且不写 globalState，避免脏值下发给 SDK。
     */
    private async selectEffort(payload: unknown): Promise<{ effort: AiReasoningEffort | null; changed: boolean }> {
        const effort = readEffortPayload(payload)
        const previous = getSelectedEffort()
        await setSelectedEffort(this.state, effort)
        this.service.notifyRuntimeChanged()
        logger.info(`CodeBuddy 推理强度已设为 ${effort === null ? '模型默认' : AI_REASONING_EFFORT_LABELS[effort]}`)
        return { effort, changed: previous !== effort }
    }

    /**
     * 选择上下文档位：0 表示跟随模型默认，其余必须是当前模型的可选档位。
     * 关键约束：档位由宿主按清单裁决 —— CLI 的 set_config 只校验正整数、不校验档位，
     * 不支持的档位会被下游静默忽略，故此处先行拒绝，不写 globalState。
     */
    private async selectContextWindow(payload: unknown): Promise<{ contextWindow: number; changed: boolean }> {
        const tokens = readContextWindowPayload(payload)
        if (tokens > 0 && !getContextWindowOptions(getSelectedCodebuddyModel()).includes(tokens)) {
            throw new Error('该上下文档位不在当前模型的可选范围内，请先在模型菜单中确认可选档位')
        }
        const previous = getSelectedContextWindow()
        await setSelectedContextWindow(this.state, tokens)
        this.service.notifyRuntimeChanged()
        logger.info(`CodeBuddy 上下文档位已设为 ${tokens > 0 ? String(tokens) : '模型默认'}`)
        return { contextWindow: tokens, changed: previous !== tokens }
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

    /** 通知前端重新拉取写入状态（目标文档变化、生成完成或工具写入成功后） */
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

    /**
     * 广播页内视图请求：宿主发起的跳转（如「添加到宅对话」后切到对话分区）。
     * 与路由事实同走 workflow 通道，但载荷形状不同，前端按 kind 分流，不会污染路由状态。
     */
    private broadcastWorkflowView(request: WorkflowViewRequest): void {
        for (const view of this.views) {
            this.post(view, { type: 'state', channel: 'workflow', payload: request })
        }
    }

    /** 选定模块：侧边导航与仪表盘入口共用同一状态，结果由广播下发，本层不判定场景 */
    private openWorkflow(payload: unknown): OpenWorkflowResult {
        if (!isOpenWorkflowRequest(payload)) {
            throw new Error('workflow/open 参数非法：module 须为非空模块键')
        }
        this.workflowRouter.selectModule(payload.module)
        return { opened: true }
    }

    /** 清除模块选定：面板回到写作管理页的对话分区 */
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
 * autoApprove 为本轮写入授权：只有严格为 true 才生效，缺省按逐次确认处理。
 * titleHint 为展示用短标题（命令名称），仅用于会话命名，超长或空值一律忽略。
 */
function readSendPayload(payload: unknown): {
    conversationId: string
    content: string
    isAutoApprove: boolean
    titleHint: string | null
} {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/send 缺少参数')
    }
    const value = payload as {
        conversationId?: unknown
        content?: unknown
        autoApprove?: unknown
        titleHint?: unknown
    }
    if (typeof value.conversationId !== 'string' || typeof value.content !== 'string') {
        throw new Error('ai/send 参数类型不正确')
    }
    const titleHint = typeof value.titleHint === 'string' ? value.titleHint.trim() : ''
    return {
        conversationId: value.conversationId,
        content: value.content,
        isAutoApprove: value.autoApprove === true,
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

/** 校验 ai/setWriteGrant 入参：只接受「仅当前文档」与「整个作品」两个范围 */
function readWriteGrantPayload(payload: unknown): AiWriteGrant {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/setWriteGrant 缺少参数')
    }
    const grant = (payload as { writeGrant?: unknown }).writeGrant
    if (grant !== 'document' && grant !== 'project') {
        throw new Error('ai/setWriteGrant 参数类型不正确')
    }
    return grant
}

/** 审批 id 上限：与 SDK 的 tool_use_id 同量级，超出视为异常载荷 */
const MAX_PERMISSION_ID_LENGTH = 128
/** 改写路径上限：合法路径远短于此，超出直接拒绝 */
const MAX_PERMISSION_PATH_LENGTH = 512
/** 答案条数与单条长度上限：答案会并入工具入参发给模型，必须限制规模 */
const MAX_ANSWER_COUNT = 8
const MAX_ANSWER_LENGTH = 512

/**
 * 校验 ai/permissionDecision 入参：id 必须存在，路径与答案逐字段收窄后再交给服务层。
 * 关键约束：答案会并入工具入参发给模型，条数与长度都必须封顶，避免超长载荷撑爆上下文。
 */
function readPermissionDecisionPayload(payload: unknown): { id: string; decision: AiPermissionDecision } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/permissionDecision 缺少参数')
    }
    const record = payload as { id?: unknown; decision?: unknown }
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id.length === 0 || id.length > MAX_PERMISSION_ID_LENGTH) {
        throw new Error('ai/permissionDecision 缺少审批 id')
    }
    if (typeof record.decision !== 'object' || record.decision === null) {
        throw new Error('ai/permissionDecision 缺少审批结果')
    }
    const raw = record.decision as { allowed?: unknown; path?: unknown; answers?: unknown }
    const decision: AiPermissionDecision = { allowed: raw.allowed === true }
    if (typeof raw.path === 'string') {
        const path = raw.path.trim()
        if (path.length > MAX_PERMISSION_PATH_LENGTH) {
            throw new Error('ai/permissionDecision 路径过长')
        }
        decision.path = path
    }
    if (typeof raw.answers === 'object' && raw.answers !== null && !Array.isArray(raw.answers)) {
        const answers: Record<string, string> = {}
        for (const [key, value] of Object.entries(raw.answers).slice(0, MAX_ANSWER_COUNT)) {
            if (typeof value !== 'string') {
                continue
            }
            const trimmedKey = key.trim()
            const trimmedValue = value.trim()
            if (trimmedKey.length === 0 || trimmedKey.length > MAX_ANSWER_LENGTH) {
                continue
            }
            if (trimmedValue.length === 0 || trimmedValue.length > MAX_ANSWER_LENGTH) {
                continue
            }
            answers[trimmedKey] = trimmedValue
        }
        decision.answers = answers
    }
    return { id, decision }
}

/**
 * 校验 ai/usage 入参：模块与时间范围走白名单，页码与页大小只接受有限正整数。
 * 关键约束：缺省即「不筛模块 + 近 7 天 + 第一页」；时间范围以枚举下发，由宿主换算成起止时间，
 * 不接受任意时间字符串，避免时区与构造注入问题。
 */
function readUsageQueryPayload(payload: unknown): AiUsageQuery {
    const fallback: AiUsageQuery = { module: null, range: '7d', page: 1, pageSize: 20 }
    if (payload === undefined || payload === null) {
        return fallback
    }
    if (typeof payload !== 'object') {
        throw new Error('ai/usage 参数类型不正确')
    }
    const value = payload as {
        module?: unknown
        range?: unknown
        page?: unknown
        pageSize?: unknown
        force?: unknown
    }
    const rawModule = value.module
    if (rawModule !== undefined && rawModule !== null && !isAiUsageModule(rawModule)) {
        throw new Error('ai/usage 模块参数不合法')
    }
    const rawRange = value.range
    if (rawRange !== undefined && !isAiUsageRange(rawRange)) {
        throw new Error('ai/usage 时间范围不合法')
    }
    return {
        module: rawModule === undefined || rawModule === null ? null : rawModule,
        range: rawRange === undefined ? fallback.range : rawRange,
        page: readPositiveInt(value.page, fallback.page),
        pageSize: readPositiveInt(value.pageSize, fallback.pageSize),
        // 只接受布尔 true：其余形态一律视为普通查询，避免前端误传字符串触发全量重扫
        force: value.force === true,
    }
}

/** 校验 ai/usage/prompt 入参：只接受非空请求 id，长度与字符集由用量服务再校验一次 */
function readUsagePromptPayload(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/usage/prompt 缺少参数')
    }
    const requestId = (payload as { requestId?: unknown }).requestId
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new Error('ai/usage/prompt 参数类型不正确')
    }
    return requestId
}

/** 校验 ai/selectContextWindow 入参：只接受 0（跟随默认）或正整数档位，超量级上限视为异常载荷 */
function readContextWindowPayload(payload: unknown): number {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/selectContextWindow 缺少参数')
    }
    const raw = (payload as { tokens?: unknown }).tokens
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        throw new Error('ai/selectContextWindow 参数类型不正确')
    }
    const value = Math.trunc(raw)
    if (value > MAX_CONTEXT_WINDOW_TOKENS) {
        throw new Error('ai/selectContextWindow 参数超出上限')
    }
    return value
}

/** 提及关键词上限：标题级短语足够，超长视为异常载荷 */
const MAX_MENTION_KEYWORD = 64
/** 提及路径上限：索引内的相对路径远短于此值 */
const MAX_MENTION_PATH = 400

/** 校验 ai/mention/search 入参：关键词按上限截断，空串由服务层直接返回空列表 */
function readKeywordPayload(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const keyword = (payload as { keyword?: unknown }).keyword
    if (typeof keyword !== 'string') {
        throw new Error(`${method} 参数类型不正确`)
    }
    return keyword.slice(0, MAX_MENTION_KEYWORD)
}

/** 校验 ai/reference/add 入参：相对语料路径 + 条目起始行，行范围由宿主重新解析得出 */
function readReferencePayload(payload: unknown): { file: string; startLine: number } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/reference/add 缺少参数')
    }
    const { file, startLine } = payload as { file?: unknown; startLine?: unknown }
    if (typeof file !== 'string' || file.length === 0 || file.length > MAX_MENTION_PATH) {
        throw new Error('ai/reference/add 参数类型不正确')
    }
    if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
        throw new Error('ai/reference/add 参数类型不正确')
    }
    return { file, startLine }
}

/** 可选行号：缺省或 null 表示整篇引用，其余必须是正整数 */
function readOptionalLine(value: unknown): number | null {
    if (value === undefined || value === null) {
        return null
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error('ai/mention/add 行号参数不正确')
    }
    return value
}

/**
 * 校验 ai/mention/add 入参：只接受相对索引路径，绝对路径与超长值一律拒绝。
 * 行范围可选，来自输入框粘贴的 `@zhai\...md:42`；区间倒序直接拒绝，避免下游按 slice 取到空内容。
 */
function readMentionPathPayload(payload: unknown): { path: string; startLine: number | null; endLine: number | null } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/mention/add 缺少参数')
    }
    const { path: target, startLine, endLine } = payload as { path?: unknown; startLine?: unknown; endLine?: unknown }
    if (typeof target !== 'string' || target.length === 0 || target.length > MAX_MENTION_PATH) {
        throw new Error('ai/mention/add 参数类型不正确')
    }
    const start = readOptionalLine(startLine)
    const end = readOptionalLine(endLine)
    if (start !== null && end !== null && end < start) {
        throw new Error('ai/mention/add 行号区间不合法')
    }
    return { path: target, startLine: start, endLine: end }
}

/** 校验 ai/selectEffort 入参：null 表示跟随模型默认，其余必须是白名单取值 */
function readEffortPayload(payload: unknown): AiReasoningEffort | null {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('ai/selectEffort 缺少参数')
    }
    const raw = (payload as { effort?: unknown }).effort
    if (raw === null || raw === undefined) {
        return null
    }
    if (!isAiReasoningEffort(raw)) {
        throw new Error('ai/selectEffort 参数不正确')
    }
    return raw
}

/** 读取有限正整数：非法值回落默认值，避免 NaN 进入偏移量计算 */
function readPositiveInt(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : fallback
}
