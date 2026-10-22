/**
 * 扩展入口：按 common.md 第 4.2 节激活流程装配 Common 与 AI 服务。
 * 流程：日志 → 打开索引库/AI 库 → schema 校验 → 注册命令/面板/监听 → 自检自愈（后台不阻塞激活）。
 */
import * as vscode from 'vscode'
import { AiChatViewProvider } from './modules/ai/aiChatProvider'
import { AiChatService } from './modules/ai/chatService'
import { registerAiCommands } from './modules/ai/commands'
import { openAiDatabase } from './modules/ai/db/connection'
import { ensureAiSchema } from './modules/ai/db/schema'
import { createAiProvider } from './modules/ai/providerRegistry'
import { WorkflowRouter } from './modules/ai/workflowRouter'
import { registerCommands } from './modules/common/commands'
import { getZhaiConfig, resolveCacheRoot } from './modules/common/config'
import { DashboardViewProvider } from './modules/common/dashboardProvider'
import { openIndexDatabase } from './modules/common/db/connection'
import { ensureSchema } from './modules/common/db/schema'
import { IndexService } from './modules/common/indexer/indexService'
import { logger } from './modules/common/logger'
import { SecretsService } from './modules/common/secrets'
import { StatusBarService } from './modules/common/statusBar'
import { openNamingDatabase } from './modules/naming/db/connection'
import { ensureNamingSchema } from './modules/naming/db/schema'
import { NamingRoutes } from './modules/naming/namingRoutes'
import { NamingService } from './modules/naming/namingService'
import { PinStore } from './modules/note/pinStore'
import { openPressDatabase } from './modules/press/db/connection'
import { PortraitService } from './modules/press/portraitService'
import { PressAiService } from './modules/press/pressAiService'
import { PressRoutes } from './modules/press/pressRoutes'
import type { IndexStatus } from './modules/common/indexer/indexService'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init(vscode.window.createOutputChannel('宅写作'))
    context.subscriptions.push({ dispose: () => logger.dispose() })

    const secrets = new SecretsService(context.secrets)
    void logSecretsDigest(secrets)

    const indexStatusEmitter = new vscode.EventEmitter<IndexStatus>()
    context.subscriptions.push(indexStatusEmitter)

    // 索引缓存目录固定为全局存储下的 zhai.vscode，与文档存储根分离
    const cacheRoot = resolveCacheRoot(context.globalStorageUri)
    const db = openIndexDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => db.close() })
    ensureSchema(db)

    const indexService = new IndexService(db, indexStatusEmitter)
    context.subscriptions.push({ dispose: () => indexService.dispose() })

    registerCommands(context, db, indexService)
    indexService.registerWatcher(context.subscriptions)

    const pinStore = new PinStore(context.globalState)
    const dashboardProvider = new DashboardViewProvider(
        context.extensionUri,
        db,
        indexService,
        pinStore,
        indexStatusEmitter.event,
    )
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, dashboardProvider),
    )

    // AI 对话：独立 ai.db 承载会话、消息与用量，避免影响索引库写入
    const aiDb = openAiDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => aiDb.close() })
    ensureAiSchema(aiDb)

    // AI 通道全扩展共用一份，按 zhai.ai.provider 装配
    const aiProvider = await createAiProvider(secrets)
    const aiChatService = new AiChatService(aiDb, secrets, aiProvider)
    context.subscriptions.push(aiChatService)

    // 工作流路由：汇聚活跃编辑器场景与入口跳转意图，供工作流面板按模块类型换页
    const workflowRouter = new WorkflowRouter(db, indexService)
    workflowRouter.register(context.subscriptions)

    registerAiCommands(context, aiChatService, secrets, workflowRouter)

    // 取名：独立 naming.db 承载生成历史与收藏，词素库全部留在宿主侧
    const namingDb = openNamingDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => namingDb.close() })
    ensureNamingSchema(namingDb)
    const namingService = new NamingService(namingDb, aiProvider)
    const namingRoutes = new NamingRoutes(namingService)

    // 写作管理：press.db 只承载 AI 配额等轻量状态，人物卡内容仍留在 webview 草稿中
    const pressDb = openPressDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => pressDb.close() })
    const pressAiService = new PressAiService(pressDb, aiProvider)
    const portraitService = new PortraitService(pressDb, secrets)
    const pressRoutes = new PressRoutes(pressAiService, portraitService)

    const aiChatProvider = new AiChatViewProvider(
        context.extensionUri,
        aiChatService,
        workflowRouter,
        namingRoutes,
        pressRoutes,
    )
    context.subscriptions.push(
        aiChatProvider,
        vscode.window.registerWebviewViewProvider(AiChatViewProvider.viewId, aiChatProvider),
    )

    const statusBar = new StatusBarService(indexService, indexStatusEmitter.event)
    statusBar.register(context.subscriptions)

    // 配置变更广播（预留：后续 AI / 索引模块消费）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('zhai.')) {
                logger.info('宅写作 配置已变更')
            }
        }),
    )

    // 自检自愈后台执行，不阻塞激活
    if (getZhaiConfig().rebuildOnActivate) {
        void indexService.selfCheck().catch((error: unknown) => logger.error('激活自检失败', error))
    }

    logger.info(
        `宅写作 已激活（workspace: ${context.workspaceState.get('initialized') === true ? '已初始化' : '首次'}）`,
    )
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
