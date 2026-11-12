/**
 * Markdown 富文本自定义编辑器：把同一份 TextDocument 渲染到 TipTap webview，保存仍走 VSCode 文档链路。
 * 复用约定：HTML 注入与 CSP 由 common/webviewHtml 统一生成，资源白名单放行 dist/webview 与存储根，
 * 与仪表盘、工作流两个 Webview 同源；不自行拼接 CSP，也不内联脚本。
 * 关键约束：不使用 CustomDocument 自管内容——同一文件可能与原生文本编辑器并存，正文以 TextDocument 为准；
 * 本阶段只挂载 webview，尚未接入编辑内容写回（P0-2），因此不得在 provider 内写文件或改脏标记。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import { RICH_EDITOR_VIEW_TYPE } from './openDocument'

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = RICH_EDITOR_VIEW_TYPE

    public constructor(private readonly extensionUri: vscode.Uri) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        token: vscode.CancellationToken,
    ): Promise<void> {
        // 未使用 token：本阶段不注册长任务，保留形参以匹配接口签名
        void token
        const { webview } = panel
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
        logger.info(`富文本编辑器已打开：${document.uri.fsPath}`)
    }
}
