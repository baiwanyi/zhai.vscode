/**
 * 编辑器装配层：注册富文本自定义编辑器与「用富文本 / 用文本」切换命令。
 * 复用约定：命令只作用于当前活跃 tab 的 URI，不接受 Webview 传入的任意路径；
 * 打开动作统一收敛在 modules/editor/openDocument，命令层只做取 URI 与派发。
 * 关键约束：supportsMultipleEditorsPerDocument 关闭，避免同一文档开出两个 webview 实例各写一份内容；
 * 本层不持有连接或文件句柄，全部 Disposable 交给 context.subscriptions 释放。
 */
import * as vscode from 'vscode'
import { MarkdownEditorProvider } from '@modules/editor/editorProvider'
import { RICH_EDITOR_VIEW_TYPE, readActiveTabUri } from '@modules/editor/openDocument'

/** 读取活跃 URI 并交给回调；取不到时提示用户先打开文档 */
async function withActiveUri(run: (uri: vscode.Uri) => Promise<void>): Promise<void> {
    const uri = readActiveTabUri()
    if (uri === undefined) {
        void vscode.window.showInformationMessage('请先打开一个 Markdown 文档')
        return
    }
    await run(uri)
}

export function assembleEditorLayer(context: vscode.ExtensionContext): void {
    const provider = new MarkdownEditorProvider(context.extensionUri)
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
}
