/**
 * 命令注册：zhai.* 命令面板与菜单入口（common.md 第 7.1 节命令清单）。
 * 约束：全部 Disposable 必须挂载到 context.subscriptions，保证停用后资源释放（AC-10）。
 */
import * as vscode from 'vscode'
import type Database from 'better-sqlite3'
import { clearSchemaData } from './db/schema'
import type { IndexService } from './indexer/indexService'
import { logger } from './logger'

export function registerCommands(
    context: vscode.ExtensionContext,
    db: Database.Database,
    indexService: IndexService,
): void {
    const register = (command: string, handler: () => unknown): void => {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler))
    }

    register('zhai.rebuildIndex', () => {
        void indexService.fullRebuild()
    })

    register('zhai.openSearch', () => {
        void vscode.commands.executeCommand('zhai.searchPanel.focus')
    })

    register('zhai.showIndexStatus', () => {
        const status = indexService.getStatus()
        void vscode.window.showInformationMessage(
            `Zhai 索引状态：已索引 ${status.indexedCount} 个文件，上次构建 ${status.lastBuiltAt ?? '从未'}`,
        )
    })

    register('zhai.clearIndex', () => {
        clearSchemaData(db)
        logger.info('索引缓存已清空')
        void vscode.window.showInformationMessage('Zhai：索引缓存已清空，可执行「重建索引」恢复')
    })

    register('zhai.exportDiagnostics', () => {
        logger.show()
    })

    register('zhai.openSettings', () => {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:zhai.zhai-vscode')
    })
}
