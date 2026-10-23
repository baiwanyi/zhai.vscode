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
import { initCodebuddyLogin } from './modules/ai/providers/codebuddyLogin'
import { hydrateSelectedModel, listCodebuddyModels } from './modules/ai/providers/codebuddyModels'
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
import { ToastService } from './modules/common/toastService'
import { openNamingDatabase } from './modules/naming/db/connection'
import { ensureNamingSchema } from './modules/naming/db/schema'
import { NamingRoutes } from './modules/naming/namingRoutes'
import { NamingService } from './modules/naming/namingService'
import { PinStore } from './modules/note/pinStore'
import { ImageProviderRouter } from './modules/press/ai/imageProvider'
import { openPressDatabase } from './modules/press/db/connection'
import { ImportSemanticService } from './modules/press/importSemanticService'
import { PortraitService } from './modules/press/portraitService'
import { PressAiService } from './modules/press/pressAiService'
import { PressRoutes } from './modules/press/pressRoutes'
import type { IndexStatus } from './modules/common/indexer/indexService'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init(vscode.window.createOutputChannel('宅写作'))
    context.subscriptions.push({ dispose: () => logger.dispose() })

    const secrets = new SecretsService(context.secrets)

    const indexStatusEmitter = new vscode.EventEmitter<IndexStatus>()
    context.subscriptions.push(indexStatusEmitter)

    // 索引缓存目录固定为全局存储下的 zhai.vscode，与文档存储根分离
    const cacheRoot = resolveCacheRoot(context.globalStorageUri)
    const db = openIndexDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => db.close() })
    ensureSchema(db)

    const indexService = new IndexService(db, indexStatusEmitter)
    context.subscriptions.push({ dispose: () => indexService.dispose() })

    // 操作反馈出口：命令层把执行结果推给已打开的 Webview，由前端 sonner 统一呈现
    const toastService = new ToastService()
    context.subscriptions.push(toastService)

    registerCommands(context, db, indexService, toastService)
    indexService.registerWatcher(context.subscriptions)

    const pinStore = new PinStore(context.globalState)
    // 工作流路由：汇聚活跃编辑器场景、选定模块与当前作品，供工作流面板按模块类型换页；
    // 仪表盘打开/删除作品时会同步作品选定，故先于仪表盘创建
    const workflowRouter = new WorkflowRouter(db, indexService)
    workflowRouter.register(context.subscriptions)
    const dashboardProvider = new DashboardViewProvider(
        context.extensionUri,
        db,
        indexService,
        pinStore,
        indexStatusEmitter.event,
        workflowRouter,
    )
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, dashboardProvider),
    )

    // AI 对话：独立 ai.db 承载会话、消息与用量，避免影响索引库写入
    const aiDb = openAiDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => aiDb.close() })
    ensureAiSchema(aiDb)

    // AI 通道全扩展共用一份：唯一实现为 CodeBuddy
    const aiProvider = await createAiProvider(secrets)
    // 模型选择存在 globalState（配置项已移除，面板菜单是唯一入口），激活时先载入内存副本
    hydrateSelectedModel(context.globalState)
    // 站点登录态同样存 globalState：面板据此决定展示登录引导还是正常空态
    initCodebuddyLogin(context.globalState)
    const aiChatService = new AiChatService(aiDb, aiProvider)
    context.subscriptions.push(aiChatService)

    registerAiCommands(context, aiChatService, workflowRouter, toastService)

    // 取名：独立 naming.db 承载生成历史与收藏，词素库全部留在宿主侧
    const namingDb = openNamingDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => namingDb.close() })
    ensureNamingSchema(namingDb)
    const namingService = new NamingService(namingDb, aiProvider)
    const namingRoutes = new NamingRoutes(namingService)

    // 写作管理：press.db 只承载 AI 配额等轻量状态，作品文档与人物卡仍以 Markdown 为准
    const pressDb = openPressDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => pressDb.close() })
    const pressAiService = new PressAiService(pressDb, aiProvider)
    const imageRouter = new ImageProviderRouter(secrets)
    const portraitService = new PortraitService(pressDb, aiProvider, imageRouter)
    // 工作台读取作品列表走索引库，文档原文直接读 press/ 下的 Markdown；打开作品时同步路由事实
    // 语义归纳依赖 AI 通道，晚于仪表盘创建，故回填给已注册的仪表盘实例；
    // 工作台的人物卡提取复用同一实例，单任务锁与配额口径因此保持一致
    const semanticService = new ImportSemanticService(pressDb, aiProvider)
    const pressRoutes = new PressRoutes(pressAiService, portraitService, db, workflowRouter, semanticService)
    dashboardProvider.attachSemanticService(semanticService)

    const aiChatProvider = new AiChatViewProvider(
        context.extensionUri,
        aiChatService,
        workflowRouter,
        namingRoutes,
        pressRoutes,
        secrets,
        context.globalState,
        toastService,
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

    // CodeBuddy 模型清单后台预热（拉起 CLI 约数秒）；未登录时返回空列表，不阻断激活，选择命令里会现拉
    void listCodebuddyModels(secrets).then((models) => {
        logger.info(
            `CodeBuddy 可用模型：${models.length > 0 ? models.map((item) => item.modelId).join(', ') : '未获取到（可能未登录）'}`,
        )
    })

    logger.info(
        `宅写作 已激活（workspace: ${context.workspaceState.get('initialized') === true ? '已初始化' : '首次'}）`,
    )
    void context.workspaceState.update('initialized', true)
}

export function deactivate(): void {
    // 全部资源通过 context.subscriptions 释放，此处无需额外清理
}
