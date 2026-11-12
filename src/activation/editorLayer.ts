/**
 * 编辑器装配层：注册富文本自定义编辑器与「用富文本 / 用文本」切换命令。
 * 复用约定：命令只作用于当前活跃 tab 的 URI，不接受 Webview 传入的任意路径；
 * 打开动作统一收敛在 modules/editor/openDocument，命令层只做取 URI 与派发。
 * 关键约束：supportsMultipleEditorsPerDocument 关闭，避免同一文档开出两个 webview 实例各写一份内容；
 * 本层不持有连接或文件句柄，全部 Disposable 交给 context.subscriptions 释放。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { setRichInsertHandler, setRichRevealHandler } from '@modules/editor/activeDocument'
import type { AnnotationDatabase } from '@modules/editor/db/connection'
import { MarkdownEditorProvider } from '@modules/editor/editorProvider'
import type { ChapterSnapshotWriter } from '@modules/editor/editorProvider'
import { RICH_EDITOR_VIEW_TYPE, readActiveTabUri } from '@modules/editor/openDocument'
import type { EditorQueryDeps } from '@modules/editor/queryService'
import type { UploadRoutes } from '@modules/upload/uploadRoutes'

/** 读取活跃 URI 并交给回调；取不到时提示用户先打开文档 */
async function withActiveUri(run: (uri: vscode.Uri) => Promise<void>): Promise<void> {
    const uri = readActiveTabUri()
    if (uri === undefined) {
        void vscode.window.showInformationMessage('请先打开一个 Markdown 文档')
        return
    }
    await run(uri)
}

export function assembleEditorLayer(
    context: vscode.ExtensionContext,
    snapshot: ChapterSnapshotWriter | null = null,
    annotationDb: (() => AnnotationDatabase) | null = null,
    query: EditorQueryDeps | null = null,
    upload: UploadRoutes | null = null,
): MarkdownEditorProvider {
    const provider = new MarkdownEditorProvider(context.extensionUri, snapshot, annotationDb, query, upload)
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false,
        }),
        vscode.commands.registerCommand('zhai.editor.openRich', async (): Promise<void> => {
            await withActiveUri(async (uri) => {
                await vscode.commands.executeCommand('vscode.openWith', uri, RICH_EDITOR_VIEW_TYPE)
            })
        }),
        vscode.commands.registerCommand('zhai.editor.openText', async (): Promise<void> => {
            await withActiveUri(async (uri) => {
                // 'default' 是 VSCode 约定的文本编辑器标识，用于从自定义编辑器切回原生
                await vscode.commands.executeCommand('vscode.openWith', uri, 'default')
            })
        }),
    )
    // 校对定位、标注跳转都通过这个注册点走富文本；未注册时它们自然回落到文本编辑器
    setRichRevealHandler((uri, request): boolean => provider.revealInPanel(uri, request))
    // 上传 / 图库的插入同样走注册点：有富文本实例就插节点，否则上传模块回落文本编辑器
    setRichInsertHandler((uri, content): boolean => provider.insertInPanel(uri, content))
    // 注册成功即打一条：排查「插件打开仍在文本编辑器」时，先确认 provider 是否真的注册上了
    logger.info(`编辑器层就绪：viewType=${MarkdownEditorProvider.viewType}`)
    // 返回实例：标注跳转需要知道当前文档是否已有富文本面板，能直接定位就不必改开文本编辑器
    return provider
}
