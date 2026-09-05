/**
 * 扩展入口：按 common.md 第 4.2 节激活流程装配全部 Common 服务。
 * 流程：日志 → 打开索引库 → schema 校验 → 注册命令/面板/监听 → 自检自愈（后台不阻塞激活）。
 */
import * as vscode from 'vscode'
import { openIndexDatabase } from './modules/common/db/connection'
import { ensureSchema } from './modules/common/db/schema'
import { registerCommands } from './modules/common/commands'
import { getZhaiConfig } from './modules/common/config'
import { IndexService } from './modules/common/indexer/indexService'
import type { IndexStatus } from './modules/common/indexer/indexService'
import { logger } from './modules/common/logger'
import { PlaceholderWebviewProvider } from './modules/common/placeholderViewProvider'
import { SearchPanelViewProvider } from './modules/common/searchPanelProvider'
import { SecretsService } from './modules/common/secrets'
import { StatusBarService } from './modules/common/statusBar'

export function activate(context: vscode.ExtensionContext): void {
    logger.init(vscode.window.createOutputChannel('Zhai 宅桌面'))
    context.subscriptions.push({ dispose: () => logger.dispose() })

    const secrets = new SecretsService(context.secrets)
    void logSecretsDigest(secrets)

    const indexStatusEmitter = new vscode.EventEmitter<IndexStatus>()
    context.subscriptions.push(indexStatusEmitter)

    const db = openIndexDatabase(context.globalStorageUri)
    context.subscriptions.push({ dispose: () => db.close() })
    ensureSchema(db)

    const indexService = new IndexService(db, indexStatusEmitter)
    context.subscriptions.push({ dispose: () => indexService.dispose() })

    registerCommands(context, db, indexService)
    indexService.registerWatcher(context.subscriptions)

    const searchProvider = new SearchPanelViewProvider(context.extensionUri, db, indexService)
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SearchPanelViewProvider.viewId, searchProvider),
    )

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PlaceholderWebviewProvider.viewId, new PlaceholderWebviewProvider()),
    )

    const statusBar = new StatusBarService(indexService, indexStatusEmitter.event)
    statusBar.register(context.subscriptions)

    // 配置变更广播（预留：后续 AI / 索引模块消费）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('zhai.')) {
                logger.info('Zhai 配置已变更')
            }
        }),
    )

    // 自检自愈后台执行，不阻塞激活
    if (getZhaiConfig().rebuildOnActivate) {
        void indexService.selfCheck().catch((error: unknown) => logger.error('激活自检失败', error))
    }

    logger.info(`Zhai 已激活（workspace: ${context.workspaceState.get('initialized') === true ? '已初始化' : '首次'}）`)
    void context.workspaceState.update('initialized', true)
}

/** 输出密钥脱敏摘要（仅校验存在性，不输出明文） */
async function logSecretsDigest(secrets: SecretsService): Promise<void> {
    const apiKey = await secrets.get('deepseekApiKey')
    logger.debug(`DeepSeek API Key：${apiKey ? '已配置' : '未配置'}`)
}

export function deactivate(): void {
    // 全部资源通过 context.subscriptions 释放，此处无需额外清理
}
