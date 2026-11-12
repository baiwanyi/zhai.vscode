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
import { isEditorChangeRequest } from '@shared/types/editor'
import type { EditorChangeResult, EditorDocSnapshot } from '@shared/types/editor'
import { isRequestMessage } from '@shared/types/messages'
import { clearRichDocument, reportRichDocument } from './activeDocument'
import { buildBlockEdits, readEditorSnapshot } from './editorDocService'
import { RICH_EDITOR_VIEW_TYPE } from './openDocument'

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = RICH_EDITOR_VIEW_TYPE

    /** 每个文档最近一次快照：回写时的块偏移基准 */
    private readonly snapshots = new Map<string, EditorDocSnapshot>()

    /** 自己写回后产生的文档版本：用于跳过回声推送 */
    private readonly appliedVersions = new Map<string, number>()

    public constructor(private readonly extensionUri: vscode.Uri) {}

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
            clearRichDocument(document.uri)
        })

        if (panel.active) {
            reportRichDocument(document.uri)
        }
        logger.info(`富文本编辑器已打开：${document.uri.fsPath}`)
        await this.pushSnapshot(document, panel)
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
            await panel.webview.postMessage({ type: 'state', channel: 'editor', payload: snapshot })
        } catch (error) {
            logger.error(`编辑器快照推送失败：${document.uri.fsPath}`, error)
        }
    }

    /** 处理前端请求：只认 snapshot 与 change，其余一律以 unknown-method 拒绝 */
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
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: snapshot })
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
                const result = await this.applyChange(document, payload.version, payload.blocks)
                await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
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

    /** 按块回写：版本过期直接拒绝，成功后再刷新快照供下一次定位 */
    private async applyChange(
        document: vscode.TextDocument,
        version: number,
        changes: readonly { index: number; html: string }[],
    ): Promise<EditorChangeResult> {
        const key = document.uri.toString()
        const snapshot = this.snapshots.get(key)
        if (snapshot === undefined || version !== document.version) {
            return { appliedBlocks: 0, stale: true, version: document.version }
        }
        const edits = await buildBlockEdits(snapshot.blocks, changes)
        if (edits.length === 0) {
            return { appliedBlocks: 0, stale: false, version: document.version }
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
            return { appliedBlocks: 0, stale: false, version: document.version }
        }
        this.appliedVersions.set(key, document.version)
        const next = await this.readSnapshot(document)
        return { appliedBlocks: edits.length, stale: false, version: next.version }
    }
}
