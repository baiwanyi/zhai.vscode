/**
 * 命令注册：zhai.* 命令面板与菜单入口（common.md 第 7.1 节命令清单）。
 * 复用约定：操作反馈统一经 ToastService 走 Webview 的 sonner，无视图时自动回退原生提示。
 * 约束：全部 Disposable 必须挂载到 context.subscriptions，保证停用后资源释放（AC-10）；
 * 索引只有「重建」一个入口：全量重建本身就是覆盖写 + 清理孤儿记录，清空类命令不再单独提供。
 */
import * as vscode from 'vscode'
import { openPromptImageDir } from '@modules/imagegen/promptImageService'
import { createAndOpenNote } from '@modules/note/noteService'
import { logger } from './logger'
import type { IndexService } from './indexer/indexService'
import type { ToastService } from './toastService'

export function registerCommands(
    context: vscode.ExtensionContext,
    indexService: IndexService,
    toast: ToastService,
): void {
    const register = (command: string, handler: () => unknown): void => {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler))
    }

    register('zhai.note.new', () => {
        void createAndOpenNote(indexService)
    })

    register('zhai.rebuildIndex', () => {
        void indexService.fullRebuild()
    })

    register('zhai.openDashboard', () => {
        void vscode.commands.executeCommand('zhai.dashboard.focus')
    })

    register('zhai.showIndexStatus', () => {
        const status = indexService.getStatus()
        toast.notifyOrShow(
            'info',
            `宅写作 索引状态：已索引 ${status.indexedCount} 个文件，上次构建 ${status.lastBuiltAt ?? '从未'}`,
        )
    })

    register('zhai.exportDiagnostics', () => {
        logger.show()
    })

    register('zhai.openSettings', () => {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:zhai.zhai-vscode')
    })

    // 提示词预览图由用户自行下载后放入图库目录，面板空态里提供入口
    register('zhai.prompt.openImageDir', () => {
        void openPromptImageDir()
    })
}
