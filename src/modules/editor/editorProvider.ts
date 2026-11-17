/**
 * Markdown 富文本自定义编辑器：把 TextDocument 的正文渲染到 TipTap webview，编辑结果按块回写同一份文档。
 * 复用约定：HTML 注入与 CSP 由 common/webviewHtml 统一生成，资源白名单放行 dist/webview 与存储根；
 * 正文解析与回写交给 editorDocService（unified 管线），本文件只负责生命周期、消息与版本校验。
 * 关键约束：不使用 CustomDocument 自管内容——同一文件可能与原生文本编辑器并存，正文以 TextDocument 为准；
 * 回写前必须比对 version，过期请求一律返回 stale 并重推快照，禁止用旧内容覆盖外部修改；
 * 自己写回引起的 onDidChangeTextDocument 要按版本跳过，否则会把 webview 输入打回去形成回声。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { toStorageDocPath } from '@modules/common/storagePath'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import {
    findAnnotation,
    insertAnnotation,
    listAnnotationsByDoc,
    removeAnnotation,
    updateAnnotation,
} from '@modules/editor/annotationRepository'
import type { AnnotationDatabase } from '@modules/editor/db/connection'
import type { UploadRoutes } from '@modules/upload/uploadRoutes'
import {
    isAddAnnotationRequest,
    isAnnotationIdRequest,
    isEditorChangeRequest,
    isEditorChatContextRequest,
    isEditorQueryAbortRequest,
    isEditorQueryRequest,
    isEditorSelectionRequest,
} from '@shared/types/editor'
import type {
    EditorBlockChange,
    EditorChangeResult,
    EditorChatContextResult,
    EditorDocSnapshot,
    EditorInsertContent,
    EditorSnapshotMessage,
} from '@shared/types/editor'
import { isRequestMessage } from '@shared/types/messages'
import { parseOpenableUrl } from '@shared/utils/url'
import { clearRichDocument, reportRichDocument } from './activeDocument'
import { buildEdits, readEditorSnapshot } from './editorDocService'
import { RICH_EDITOR_VIEW_TYPE } from './openDocument'
import { listRecentQueries } from './queryRepository'
import { runEditorQuery } from './queryService'
import type { EditorQueryDeps } from './queryService'
import type Database from 'better-sqlite3'

/**
 * 校验待打开的链接：Webview 传来的地址不可信，必须能解析且协议在白名单内。
 * 白名单与解析口径由 @shared/utils/url 统一维护，宿主与前端不再各写一份。
 * 不合格返回 null，由调用方按 invalid-payload 拒绝，避免借本协议打开任意地址。
 */
function readOpenableUrl(payload: unknown): string | null {
    const value = typeof payload === 'object' && payload !== null ? (payload as { url?: unknown }).url : undefined
    return typeof value === 'string' ? parseOpenableUrl(value) : null
}

/** 写回前留底：章节与其它 md 文档共用这一个入口，按结构化接口声明便于替身注入 */
export interface ChapterSnapshotWriter {
    captureChapterBeforeWrite: (uri: vscode.Uri, content: string) => Promise<void>
}

/**
 * 把一段文本加入宅对话上下文：由 AI 层注入，编辑器只交出自身文档、文本与块在原文中的字符区间。
 * 关键约束：文档由宿主提供，引用只能落在当前打开的这份文件上，webview 传不了路径；
 * 字符区间用来换算精确行号，为 null 时由实现方退回按文本定位。
 */
export type AddChatContext = (
    document: vscode.TextDocument,
    quote: string,
    blockRange: { start: number; end: number } | null,
) => Promise<EditorChatContextResult>

/** 宿主缓存的选区快照：quote 用于在 Markdown 里定位，块序号仅作提示 */
export interface EditorSelectionSnapshot {
    quote: string
    blockIndex: number
    isEmpty: boolean
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = RICH_EDITOR_VIEW_TYPE

    /** 每个文档最近一次快照：回写时的块偏移基准 */
    private readonly snapshots = new Map<string, EditorDocSnapshot>()

    /** 自己写回后产生的文档版本：用于跳过回声推送 */
    private readonly appliedVersions = new Map<string, number>()

    /** 正在执行 applyEdit 的文档：变更事件若先于回执到达，靠它识别回声，否则会推快照把前端整篇重建 */
    private readonly applying = new Set<string>()

    /** 已留底过的文档：每个打开会话只留一次，避免每 500ms 就生成一版章节快照 */
    private readonly capturedChapters = new Set<string>()

    /** 在途查询：reqId → 控制器与所属文档，关闭 tab 时只中断该文档发出的请求 */
    private readonly queries = new Map<string, { controller: AbortController; docKey: string }>()

    /** 打开中的富文本面板：标注跳转据此判断能否直接定位，而不是改开文本编辑器 */
    private readonly panels = new Map<string, vscode.WebviewPanel>()

    /** 各文档最近一次上报的选区：选区级引用与 AI 写回据此定位，key 为相对路径 */
    private readonly selections = new Map<string, EditorSelectionSnapshot>()

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly snapshot: ChapterSnapshotWriter | null = null,
        private readonly annotationDb: (() => AnnotationDatabase) | null = null,
        private readonly query: EditorQueryDeps | null = null,
        /** 上传协议：编辑器 webview 自己发起粘贴 / 拖拽上传，复用工作流面板那一套路由实例 */
        private readonly upload: UploadRoutes | null = null,
        /** 加入宅对话：块菜单把当前块追加为对话上下文，由 AI 层注入 */
        private readonly addChatContext: AddChatContext | null = null,
    ) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        token: vscode.CancellationToken,
    ): Promise<void> {
        void token
        const { webview } = panel
        const key = document.uri.toString()
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'), resolveStorageRoot()],
        }
        try {
            webview.html = await buildWebviewHtml(webview, this.extensionUri, 'editor/index.html')
        } catch (error) {
            // 构建产物缺失时给出可执行的提示，而不是让用户面对空白 tab
            webview.html = `<html><body><h3>宅写作</h3><p>编辑器资源缺失，请先执行 pnpm run compile（${String(
                error,
            )}）</p></body></html>`
            return
        }

        this.panels.set(key, panel)
        const subscriptions: vscode.Disposable[] = [
            webview.onDidReceiveMessage((message: unknown) => {
                void this.handleMessage(document, panel, message)
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() !== key) {
                    return
                }
                // 回声判定必须双保险：applyEdit 执行期间事件可能先于回执到达（此时版本号还没记下来），
                // 记录值又可能因一次编辑产生多个版本而落后。漏判的代价是推一次快照，
                // 前端收到就 setContent 整篇重建——正在打字的选区、浮层与菜单全部被打断。
                if (this.applying.has(key)) {
                    return
                }
                const applied = this.appliedVersions.get(key)
                if (applied !== undefined && event.document.version <= applied) {
                    if (event.document.version === applied) {
                        this.appliedVersions.delete(key)
                    }
                    return
                }
                void this.pushSnapshot(document, panel)
            }),
            // 富文本 tab 获得焦点时上报活跃文档：工作流路由与插入目标据此判断当前文档
            panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.active) {
                    reportRichDocument(document.uri)
                }
            }),
        ]
        panel.onDidDispose(() => {
            for (const subscription of subscriptions) {
                subscription.dispose()
            }
            this.snapshots.delete(key)
            this.appliedVersions.delete(key)
            this.capturedChapters.delete(key)
            this.panels.delete(key)
            this.selections.delete(this.readRelativePath(document))
            // 只中断本文档发起的那几条：queries 跨文档共用，一刀切会把别的 tab 正在跑的查询也取消
            for (const [clientId, entry] of this.queries) {
                if (entry.docKey === key) {
                    entry.controller.abort()
                    this.queries.delete(clientId)
                }
            }
            clearRichDocument(document.uri)
        })

        if (panel.active) {
            reportRichDocument(document.uri)
        }
        // 不 await：postMessage 在 webview 脚本就绪前会一直挂起，resolveCustomTextEditor 迟迟不返回，
        // 调用方（note/open、press/openChapter 等）就会 10s 超时；前端本来会主动拉 editor/snapshot，
        // 首推只是加速展示，不能让它挡住打开流程。
        void this.pushSnapshot(document, panel)
    }

    /** 读取当前文档快照并记录为回写基准 */
    private async readSnapshot(document: vscode.TextDocument): Promise<EditorDocSnapshot> {
        const path = this.readRelativePath(document)
        const snapshot = await readEditorSnapshot(document.getText(), document.version, path)
        this.snapshots.set(document.uri.toString(), snapshot)
        return snapshot
    }

    /** 向 webview 推送快照：前端按 version 去重，重复推送不会重置光标 */
    private async pushSnapshot(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const snapshot = await this.readSnapshot(document)
            // 不 await 投递：webview 未就绪时它可能长时间挂在 pending，把调用链一起拖住
            panel.webview
                .postMessage({ type: 'state', channel: 'editor', payload: this.toSnapshotMessage(snapshot, panel) })
                .then(
                    () => undefined,
                    (error: unknown) => {
                        const reason = error instanceof Error ? error.message : String(error)
                        logger.warn(`编辑器快照投递失败：${document.uri.fsPath}（${reason}）`)
                    },
                )
        } catch (error) {
            logger.error(`编辑器快照推送失败：${document.uri.fsPath}`, error)
        }
    }

    /**
     * 在已打开的富文本面板里定位原文：没有实例时返回 false，调用方改走文本编辑器。
     * 关键约束：只发消息不等待回执——webview 不可达时也要立刻回落，不能把跳转卡在这里。
     */
    public revealInPanel(uri: vscode.Uri, request: { quote: string; blockIndex: number }): boolean {
        const panel = this.panels.get(uri.toString())
        if (panel === undefined) {
            return false
        }
        void panel.webview.postMessage({
            type: 'state',
            channel: 'editor',
            payload: { kind: 'reveal', quote: request.quote, blockIndex: request.blockIndex },
        })
        panel.reveal(undefined, false)
        return true
    }

    /**
     * 往已打开的富文本面板插入内容：图片插节点、其余插文本。
     * 复用约定：上传模块只负责落盘与算引用路径，插入动作统一由这里转给 webview，
     * 与文本编辑器路径（WorkspaceEdit 插行）互不干扰。
     * 关键约束：没有面板时返回 false，调用方应回报「no-editor」而不是静默成功。
     */
    public insertInPanel(uri: vscode.Uri, content: EditorInsertContent): boolean {
        const panel = this.panels.get(uri.toString())
        if (panel === undefined) {
            return false
        }
        void panel.webview.postMessage({
            type: 'state',
            channel: 'editor',
            payload: { kind: 'insert', image: content.image, text: content.text },
        })
        panel.reveal(undefined, false)
        return true
    }

    /** 读取最近一次上报的选区：没有上报过（或已关闭）时返回 null，调用方应回落到整篇 */
    public readSelectionFor(uri: vscode.Uri): EditorSelectionSnapshot | null {
        return this.selections.get(toStorageDocPath(uri)) ?? null
    }

    /** 快照消息：附带存储根的 webview 前缀，供前端把 `@zhai/` 引用转成可加载地址 */
    private toSnapshotMessage(snapshot: EditorDocSnapshot, panel: vscode.WebviewPanel): EditorSnapshotMessage {
        return {
            ...snapshot,
            assetPrefix: panel.webview.asWebviewUri(resolveStorageRoot()).toString(),
        }
    }

    /** 取标注库连接：未装配时返回 null，协议层据此给出「尚未就绪」 */
    private readAnnotationDatabase(): Database.Database | null {
        return this.annotationDb === null ? null : this.annotationDb().db
    }

    /**
     * 当前文档的库口径路径：标注 / 查询的 doc_path、快照 path 与前端上报的 payload.path 共用这一处。
     * 关键约束：口径必须与 storagePath.toStorageDocPath 一致，否则编辑器与总览页会各认一套路径。
     */
    private readRelativePath(document: vscode.TextDocument): string {
        return toStorageDocPath(document.uri)
    }

    /** 文档标题快照：取文件名去扩展名，不额外解析 Frontmatter */
    private readDocTitle(document: vscode.TextDocument): string {
        const name = document.uri.path.split('/').pop() ?? ''
        return name.endsWith('.md') ? name.slice(0, -3) : name
    }

    /** 统一错误回执：前端按 code 分发文案 */
    private async respondError(
        panel: vscode.WebviewPanel,
        reqId: string,
        code: string,
        message: string,
    ): Promise<void> {
        await panel.webview.postMessage({ type: 'response', reqId, ok: false, error: { code, message } })
    }

    /**
     * 标注协议：列表、新建划线、删除、改色。
     * 关键约束：所有写操作都要求 payload.path 与当前文档相对路径一致，
     * 否则前端拼错路径就能往别的文档里塞标注；返回 true 表示已处理。
     */
    private async handleAnnotation(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        reqId: string,
        method: string,
        payload: unknown,
    ): Promise<boolean> {
        if (method !== 'editor/annotations' && !method.startsWith('editor/annotation/')) {
            return false
        }
        const db = this.readAnnotationDatabase()
        if (db === null) {
            await this.respondError(panel, reqId, 'annotation-db-unavailable', '标注库尚未就绪')
            return true
        }
        const path = this.readRelativePath(document)
        if (method === 'editor/annotations') {
            const items = listAnnotationsByDoc(db, path)
            await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { items } })
            return true
        }
        if (method === 'editor/annotation/add') {
            if (!isAddAnnotationRequest(payload)) {
                await this.respondError(panel, reqId, 'invalid-payload', '划线参数非法')
                return true
            }
            if (payload.path !== path) {
                await this.respondError(panel, reqId, 'path-mismatch', '标注路径与当前文档不一致')
                return true
            }
            const item = insertAnnotation(db, {
                docPath: path,
                docTitle: this.readDocTitle(document),
                kind: payload.kind,
                mode: 'inline',
                quote: payload.draft.quote,
                prefix: payload.draft.prefix,
                suffix: payload.draft.suffix,
                startOffset: payload.draft.startOffset,
                endOffset: payload.draft.endOffset,
                blockId: payload.draft.blockId,
                blockIndex: payload.draft.blockIndex,
                blockHash: payload.draft.blockHash,
                blockText: payload.draft.blockText,
                color: payload.color,
                note: payload.note,
                replies: '[]',
                orphaned: false,
            })
            await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { item } })
            return true
        }
        if (!isAnnotationIdRequest(payload)) {
            await this.respondError(panel, reqId, 'invalid-payload', '标注参数非法')
            return true
        }
        if (payload.path !== path) {
            await this.respondError(panel, reqId, 'path-mismatch', '标注路径与当前文档不一致')
            return true
        }
        // 归属校验：path 与 id 是两个独立字段，只比对 path 挡不住「当前文档路径 + 别篇标注 id」
        const target = findAnnotation(db, payload.id)
        if (target === null) {
            await this.respondError(panel, reqId, 'annotation-missing', '标注不存在或已被删除')
            return true
        }
        if (target.docPath !== path) {
            await this.respondError(panel, reqId, 'path-mismatch', '标注不属于当前文档')
            return true
        }
        if (method === 'editor/annotation/remove') {
            const isRemoved = removeAnnotation(db, payload.id)
            await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { removed: isRemoved } })
            return true
        }
        // 按传入字段增量更新：改色只传 color，改批注只传 note，避免把另一项误清空
        const isUpdated = updateAnnotation(db, payload.id, {
            ...(payload.color === undefined ? {} : { color: payload.color }),
            ...(payload.note === undefined ? {} : { note: payload.note }),
        })
        await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { updated: isUpdated } })
        return true
    }

    /** 执行查询并把增量与终态推给 webview：终态带全文，重开弹窗也能看到上次结果 */
    private async runQuery(
        panel: vscode.WebviewPanel,
        request: { quote: string; question: string; clientId: string },
        docPath: string,
        controller: AbortController,
    ): Promise<void> {
        const deps = this.query
        if (deps === null) {
            return
        }
        try {
            const outcome = await runEditorQuery(deps, {
                docPath,
                quote: request.quote,
                question: request.question,
                signal: controller.signal,
                onDelta: (delta): void => {
                    void panel.webview.postMessage({
                        type: 'state',
                        channel: 'editor',
                        payload: { kind: 'query', clientId: request.clientId, delta },
                    })
                },
            })
            await panel.webview.postMessage({
                type: 'state',
                channel: 'editor',
                payload: {
                    kind: 'query',
                    clientId: request.clientId,
                    status: outcome.ok ? 'done' : 'error',
                    reason: outcome.reason ?? null,
                    content: outcome.content,
                    fromCache: outcome.fromCache === true,
                },
            })
        } finally {
            // 同一 clientId 可能已被后一次请求覆盖：只清理自己这条
            if (this.queries.get(request.clientId)?.controller === controller) {
                this.queries.delete(request.clientId)
            }
        }
    }

    /** 处理前端请求：snapshot、change、查询与标注协议，其余一律以 unknown-method 拒绝 */
    private async handleMessage(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: unknown,
    ): Promise<void> {
        if (!isRequestMessage(message)) {
            return
        }
        const { reqId, method, payload } = message
        try {
            if (method === 'editor/snapshot') {
                const snapshot = await this.readSnapshot(document)
                await panel.webview.postMessage({
                    type: 'response',
                    reqId,
                    ok: true,
                    payload: this.toSnapshotMessage(snapshot, panel),
                })
                return
            }
            if (method === 'editor/change') {
                if (!isEditorChangeRequest(payload)) {
                    await panel.webview.postMessage({
                        type: 'response',
                        reqId,
                        ok: false,
                        error: { code: 'invalid-payload', message: '回写参数非法' },
                    })
                    return
                }
                const result = await this.applyChange(document, payload.version, payload.edits)
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
                return
            }
            // 显式保存：webview 内没有原生菜单，Ctrl/Cmd+S 由前端拦截后发起，
            // autoSave 关闭时也能真正落盘（常规回写只置脏，不替用户决定何时写文件）
            if (method === 'editor/save') {
                const isSaved = await this.saveDocumentNow(document)
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { saved: isSaved } })
                return
            }
            // 块菜单「添加到 AI 对话」：只传文本，引用定位、上下文写入与面板跳转都在宿主侧完成，
            // 前端只按回执提示结果——这样 webview 拿不到也写不了任意文件的引用
            if (method === 'editor/chat/context') {
                if (!isEditorChatContextRequest(payload)) {
                    await this.respondError(panel, reqId, 'invalid-payload', '加入对话参数非法')
                    return
                }
                if (this.addChatContext === null) {
                    await this.respondError(panel, reqId, 'ai-unavailable', 'AI 通道尚未就绪')
                    return
                }
                const result = await this.addChatContext(
                    document,
                    payload.quote,
                    this.readBlockRange(document, payload.blockIndex, payload.endBlockIndex),
                )
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
                return
            }
            // 打开正文里的链接：前端在 Ctrl/Cmd + 点击时发起，普通点击不会走到这里
            if (method === 'editor/openLink') {
                const url = readOpenableUrl(payload)
                if (url === null) {
                    await this.respondError(panel, reqId, 'invalid-payload', '链接地址不合法')
                    return
                }
                const isOpened = await vscode.env.openExternal(vscode.Uri.parse(url))
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { opened: isOpened } })
                return
            }
            // 选区上报：前端节流后推来，宿主只做缓存与路径校验，供选区引用与写回定位使用
            if (method === 'editor/selection') {
                if (!isEditorSelectionRequest(payload) || payload.path !== this.readRelativePath(document)) {
                    await this.respondError(panel, reqId, 'invalid-payload', '选区上报参数非法')
                    return
                }
                this.selections.set(payload.path, {
                    quote: payload.quote,
                    blockIndex: payload.blockIndex,
                    isEmpty: payload.isEmpty,
                })
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { ok: true } })
                return
            }
            // 上传：编辑器内粘贴 / 拖拽要自己发起上传，复用工作流面板的上传路由，落盘口径完全一致
            if (method.startsWith('upload/')) {
                if (this.upload === null) {
                    await this.respondError(panel, reqId, 'upload-unavailable', '上传模块尚未装配')
                    return
                }
                const result = await this.upload.handle(method, payload, (uri) =>
                    panel.webview.asWebviewUri(uri).toString(),
                )
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
                return
            }
            if (method === 'editor/query') {
                if (!isEditorQueryRequest(payload)) {
                    await this.respondError(panel, reqId, 'invalid-payload', '查询参数非法')
                    return
                }
                if (payload.path !== this.readRelativePath(document)) {
                    await this.respondError(panel, reqId, 'path-mismatch', '查询路径与当前文档不一致')
                    return
                }
                if (this.query === null) {
                    await this.respondError(panel, reqId, 'ai-unavailable', 'AI 通道尚未就绪')
                    return
                }
                const controller = new AbortController()
                this.queries.set(payload.clientId, { controller, docKey: document.uri.toString() })
                // 先回执再流式推送：request 的 promise 立即结束，增量走 state 通道
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { started: true } })
                void this.runQuery(panel, payload, this.readRelativePath(document), controller)
                return
            }
            if (method === 'editor/query/history') {
                const historyDb = this.readAnnotationDatabase()
                // 库不可用时返回空清单：历史是附加能力，不该让弹窗报错
                const items = historyDb === null ? [] : listRecentQueries(historyDb, this.readRelativePath(document))
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { items } })
                return
            }
            if (method === 'editor/query/abort') {
                if (!isEditorQueryAbortRequest(payload)) {
                    await this.respondError(panel, reqId, 'invalid-payload', '取消参数非法')
                    return
                }
                const entry = this.queries.get(payload.clientId)
                // clientId 由前端生成，不排除两个文档撞上同一个值：只中断本文档发起的请求
                if (entry !== undefined && entry.docKey === document.uri.toString()) {
                    entry.controller.abort()
                }
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: { aborted: true } })
                return
            }
            if (await this.handleAnnotation(document, panel, reqId, method, payload)) {
                return
            }
            await panel.webview.postMessage({
                type: 'response',
                reqId,
                ok: false,
                error: { code: 'unknown-method', message: `未知的编辑器方法：${method}` },
            })
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            logger.error(`编辑器请求失败：${method}（${reason}）`)
            await panel.webview.postMessage({
                type: 'response',
                reqId,
                ok: false,
                error: { code: 'editor-error', message: reason },
            })
        }
    }

    /**
     * 显式落盘：只响应用户主动保存（webview 的 Ctrl/Cmd+S），常规回写仍然只置脏。
     * 复用约定：document.save() 写的是同一份 TextDocument，与原生文本编辑器保存完全等价。
     * 关键约束：不做脏检查以外的判断——文件只读、被占用时 save() 返回 false，由前端提示。
     */
    private async saveDocumentNow(document: vscode.TextDocument): Promise<boolean> {
        if (!document.isDirty) {
            return true
        }
        return document.save()
    }

    /**
     * 块序号 → Markdown 原文区间：块快照与前端 TipTap 的顶层块同序（回写也依赖这一对应关系）。
     * 快照缺失、序号越界或偏移已超出当前文档时返回 null，由调用方退回按文本定位。
     * 关键约束：给了终点块序号就取首块起点到末块终点的整段区间——选区工具条按「选中行」引用，
     * 行范围由首末块决定即可覆盖中间所有行；终点块倒序时只取起点块；
     * 终点块越界（两端块序列短暂不一致）时按最后一个块收敛并记日志——
     * 此时宁可多引到文末，也不能退化成「只引用第一行」。
     */
    private readBlockRange(
        document: vscode.TextDocument,
        blockIndex: number | undefined,
        endBlockIndex?: number,
    ): { start: number; end: number } | null {
        if (blockIndex === undefined || blockIndex < 0) {
            return null
        }
        const blocks = this.snapshots.get(document.uri.toString())?.blocks
        const first = blocks?.[blockIndex]
        if (first === undefined || blocks === undefined) {
            return null
        }
        const lastBlockIndex = blocks.length - 1
        const requestedEnd = endBlockIndex === undefined || endBlockIndex <= blockIndex ? blockIndex : endBlockIndex
        if (requestedEnd > lastBlockIndex) {
            logger.debug(`选中行终点块序号越界，按最后一个块收敛：${String(requestedEnd)}/${String(lastBlockIndex)}`)
        }
        const last = blocks[Math.min(requestedEnd, lastBlockIndex)] ?? first
        if (last.end > document.getText().length) {
            return null
        }
        return { start: first.start, end: last.end }
    }

    /**
     * 按区间回写：版本过期直接拒绝，成功后再刷新快照并把新块区间回传前端。
     * 区间由前端按快照偏移算出，这里只做范围与语法校验——按块下标定位会在插入块后整体位移。
     */
    private async applyChange(
        document: vscode.TextDocument,
        version: number,
        ranges: readonly EditorBlockChange[],
    ): Promise<EditorChangeResult> {
        const key = document.uri.toString()
        const snapshot = this.snapshots.get(key)
        if (snapshot === undefined || version !== document.version) {
            return { appliedBlocks: 0, stale: true, version: document.version }
        }
        const text = document.getText()
        const edits = await buildEdits(text, ranges)
        if (edits.length === 0) {
            // 区间被转换放弃（越界、重叠、合并单元格等）时会落到这里。
            // 必须带上 discarded 回执：前端据此提示「没落盘」，而不是当成成功继续刷新基准偏移，
            // 否则下一轮会算出同一批无效区间——表现就是改了永远不保存，且屏幕上一声不响。
            logger.warn(`回写未产生写入：${document.uri.fsPath}（${String(ranges.length)} 个区间）`)
            return { appliedBlocks: 0, stale: false, version: document.version, discarded: ranges.length }
        }
        // 不再做「写入前白名单自检」：编辑态已不再因语法把整篇转只读，
        // 这里再拦一次只会让链接、划线这类正常改动被静默回滚
        // 首次真正写入前留底：章节走按章时间线，其余 md 走单文件时间线，二者都由快照服务内部判定
        if (this.snapshot !== null && !this.capturedChapters.has(key)) {
            await this.snapshot.captureChapterBeforeWrite(document.uri, text)
            this.capturedChapters.add(key)
        }
        const workspaceEdit = new vscode.WorkspaceEdit()
        for (const item of edits) {
            workspaceEdit.replace(
                document.uri,
                new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)),
                item.text,
            )
        }
        // 预期版本必须先记下再执行：change 事件可能先于 applyEdit 的回执到达，
        // 那时 appliedVersions 还是空的，回声会被当成外部修改推回前端
        this.appliedVersions.set(key, document.version + 1)
        this.applying.add(key)
        let isApplied: boolean
        try {
            isApplied = await vscode.workspace.applyEdit(workspaceEdit)
        } finally {
            this.applying.delete(key)
        }
        if (!isApplied) {
            // applyEdit 被拒绝时既没异常也没落盘：以前静默返回「成功」，前端看到链接变蓝却写不进文件
            this.appliedVersions.delete(key)
            logger.warn(
                `回写被编辑器拒绝：${document.uri.fsPath}（${String(edits.length)} 个区间，version ${String(document.version)}）`,
            )
            return { appliedBlocks: 0, stale: false, failed: true, version: document.version, blocks: snapshot.blocks }
        }
        // 覆盖成写入后的真实版本：迟到的 change 事件靠它命中并跳过推送
        this.appliedVersions.set(key, document.version)
        // 不主动 document.save()：回写只把改动写进 TextDocument 并置脏，
        // 落盘交给 VSCode 自己的 files.autoSave 机制（afterDelay / onFocusChange 等），
        // 用户设为 off 时就是「手动保存」，这与原生编辑器的行为一致，不该由扩展越权代劳
        const next = await this.readSnapshot(document)
        return { appliedBlocks: edits.length, stale: false, version: next.version, blocks: next.blocks }
    }
}
