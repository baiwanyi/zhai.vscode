/**
 * 激活收尾：配置变更同步、激活自检、「已初始化」标记与激活完成日志。
 * 复用约定：存储根变更后重注册增量监听并补一次自检，媒体与在线图库的连接缓存随之重建；
 * 耗时从入口传入的激活起点算起，与分段打点同源；失败一律走 runWithLoggedFailure 记日志。
 * 关键约束：初始化标记必须在读取旧值之后再写——先写会让每次启动的日志都显示「已初始化」。
 */
import * as vscode from 'vscode'
import { runWithLoggedFailure } from '@modules/common/asyncTask'
import { getZhaiConfig } from '@modules/common/config'
import type { IndexService } from '@modules/common/indexer/indexService'
import { logger } from '@modules/common/logger'
import { closeMediaDatabases } from '@modules/media/db/connection'
import { closeStockDatabases } from '@modules/stock/db/connection'

/** 收尾依赖：入口提供上下文、索引服务与激活起点时间 */
export interface LifecycleDeps {
    context: vscode.ExtensionContext
    indexService: IndexService
    /** 激活起点（performance.now()）：完成日志据此算总耗时 */
    activateStartedAt: number
}

/** 注册激活收尾：配置同步、自检自愈、完成日志与初始化标记 */
export function registerLifecycleHooks(deps: LifecycleDeps): void {
    const { context, indexService, activateStartedAt } = deps
    // 配置变更广播：存储根可能被改动，媒体索引连接必须按新根重建，否则会写进旧目录的库
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('zhai.')) {
                logger.info('宅写作 配置已变更')
                closeMediaDatabases()
                closeStockDatabases()
            }
            // 增量监听按存储根生成 pattern：改根后不重建，新目录的改动永远不会进索引
            if (event.affectsConfiguration('zhai.storage.rootPath')) {
                indexService.registerWatcher(context.subscriptions)
                runWithLoggedFailure((): Promise<void> => indexService.selfCheck(), '存储根变更后自检失败')
            }
        }),
    )

    // 自检自愈后台执行，不阻塞激活
    if (getZhaiConfig().rebuildOnActivate) {
        runWithLoggedFailure((): Promise<void> => indexService.selfCheck(), '激活自检失败')
    }

    // 模型清单不在此预热：它属于工作流面板的首屏数据，由 AiChatViewProvider 在面板打开时拉取，
    // 激活与「打开面板」是两个阶段，混在激活里会让窗口启动替面板付一次 CLI 子进程开销
    logger.info(
        `宅写作 已激活（workspace: ${context.workspaceState.get('initialized') === true ? '已初始化' : '首次'}），耗时 ${String(Math.round(performance.now() - activateStartedAt))}ms`,
    )
    void context.workspaceState.update('initialized', true).then(undefined, (error: unknown) => {
        logger.warn(`记录初始化标记失败：${error instanceof Error ? error.message : String(error)}`)
    })
}
