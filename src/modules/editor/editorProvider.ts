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
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import {
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
    isEditorQueryAbortRequest,
    isEditorQueryRequest,
    isEditorSelectionRequest,
    isEditorSourceSaveRequest,
} from '@shared/types/editor'
import type {
    EditorBlockChange,
    EditorChangeResult,
    EditorDocSnapshot,
    EditorInsertContent,
    EditorSnapshotMessage,
} from '@shared/types/editor'
import { isRequestMessage } from '@shared/types/messages'
import { clearRichDocument, reportRichDocument } from './activeDocument'
import { applyBlockEdits, buildEdits, readEditorSnapshot } from './editorDocService'
import { RICH_EDITOR_VIEW_TYPE } from './openDocument'
import { listRecentQueries } from './queryRepository'
import { runEditorQuery } from './queryService'
import type { EditorQueryDeps } from './queryService'
import type Database from 'better-sqlite3'

/** 章节写回前留底：只用到这一个方法，按结构化接口声明便于替身注入 */
export interface ChapterSnapshotWriter {
    captureChapterBeforeWrite: (uri: vscode.Uri, content: string) => Promise<void>
}

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

    /** 已留底过的文档：每个打开会话只留一次，避免每 500ms 就生成一版章节快照 */
    private readonly capturedChapters = new Set<string>()

    /** 在途查询：reqId → AbortController，关闭弹窗或关 tab 时统一中断 */
    private readonly queries = new Map<string, AbortController>()

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
                if (this.appliedVersions.get(key) === event.document.version) {
                    this.appliedVersions.delete(key)
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
            for (const controller of this.queries.values()) {
                controller.abort()
            }
            this.queries.clear()
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
        const path = vscode.workspace.asRelativePath(document.uri, false)
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
        return this.selections.get(vscode.workspace.asRelativePath(uri, false)) ?? null
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

    /** 当前文档相对路径：与快照里的 path 同口径，用于拒绝跨文档写标注 */
    private readRelativePath(document: vscode.TextDocument): string {
        return vscode.workspace.asRelativePath(document.uri, false)
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
            this.queries.delete(request.clientId)
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
            if (method === 'editor/source') {
                await panel.webview.postMessage({
                    type: 'response',
                    reqId,
                    ok: true,
                    payload: {
                        path: this.readRelativePath(document),
                        version: document.version,
                        content: document.getText(),
                    },
                })
                return
            }
            if (method === 'editor/source/save') {
                if (!isEditorSourceSaveRequest(payload)) {
                    await this.respondError(panel, reqId, 'invalid-payload', '源码保存参数非法')
                    return
                }
                if (payload.path !== this.readRelativePath(document)) {
                    await this.respondError(panel, reqId, 'path-mismatch', '保存路径与当前文档不一致')
                    return
                }
                if (payload.version !== document.version) {
                    await panel.webview.postMessage({
                        type: 'response',
                        reqId,
                        ok: true,
                        payload: { saved: false, stale: true, version: document.version },
                    })
                    return
                }
                // 整篇替换：源码模式就是直接改原文，不存在块级定位问题
                const edit = new vscode.WorkspaceEdit()
                const text = document.getText()
                edit.replace(
                    document.uri,
                    new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
                    payload.content,
                )
                const isApplied = await vscode.workspace.applyEdit(edit)
                this.appliedVersions.set(document.uri.toString(), document.version)
                const next = await this.readSnapshot(document)
                await panel.webview.postMessage({
                    type: 'response',
                    reqId,
                    ok: true,
                    payload: { saved: isApplied, stale: false, version: next.version },
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
                this.queries.set(payload.clientId, controller)
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
                this.queries.get(payload.clientId)?.abort()
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
            return { appliedBlocks: 0, stale: false, version: document.version, blocks: snapshot.blocks }
        }
        // 写入前自检：把结果拼出来重新解析，确认没有引入白名单外语法
        // （例如把表格、图片或链接粘进富文本），否则落盘后反而变成整篇只读
        const nextText = applyBlockEdits(text, edits)
        const nextSnapshot = await readEditorSnapshot(nextText, document.version, snapshot.path)
        if (!nextSnapshot.editable) {
            return { appliedBlocks: 0, stale: false, version: document.version, rejected: 'unsupported-syntax' }
        }
        // 首次真正写入前留底：快照服务只对 Chapters 下的文档生效，其它文档内部直接返回
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
        const isApplied = await vscode.workspace.applyEdit(workspaceEdit)
        if (!isApplied) {
            return { appliedBlocks: 0, stale: false, version: document.version, blocks: snapshot.blocks }
        }
        this.appliedVersions.set(key, document.version)
        const next = await this.readSnapshot(document)
        return { appliedBlocks: edits.length, stale: false, version: next.version, blocks: next.blocks }
    }
}
