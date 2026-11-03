/**
 * AI 层装配：ai.db 承载会话、消息与用量，naming.db 按需打开承载取名历史，通道全扩展共用一份。
 * 复用约定：对话、取名、写作、校对、出图、语义归纳共用同一个 AiProvider 与 UsageRecorder，
 * 记账口径因此只有一套；写回前留底统一交给作品快照服务的 captureChapterBeforeWrite。
 * 关键约束：ai.db 必须在激活期打开（会话与用量是首屏数据），naming.db 走惰性打开；
 * 模型选择与站点登录态存在 globalState，激活时先载入内存副本，面板打开时不再回读。
 */
import { AiChatService } from '@modules/ai/chatService'
import { CliUsageIndex } from '@modules/ai/cliUsageIndex'
import { registerAiCommands } from '@modules/ai/commands'
import { openAiDatabase } from '@modules/ai/db/connection'
import { ensureAiSchema } from '@modules/ai/db/schema'
import { MentionService } from '@modules/ai/mentionService'
import type { AiProvider } from '@modules/ai/provider'
import { createAiProvider } from '@modules/ai/providerRegistry'
import { initCodebuddyLogin } from '@modules/ai/providers/codebuddyLogin'
import { hydrateSelectedModel } from '@modules/ai/providers/codebuddyModels'
import { ReferenceService } from '@modules/ai/referenceService'
import { UsageRecorder } from '@modules/ai/usageRecorder'
import { AiUsageService } from '@modules/ai/usageService'
import type { WorkflowRouter } from '@modules/ai/workflowRouter'
import { lazyDatabase } from '@modules/common/lazyDatabase'
import type { SecretsService } from '@modules/common/secrets'
import type { ToastService } from '@modules/common/toastService'
import { openNamingDatabase } from '@modules/naming/db/connection'
import { ensureNamingSchema } from '@modules/naming/db/schema'
import { NamingRoutes } from '@modules/naming/namingRoutes'
import { NamingService } from '@modules/naming/namingService'
import type { PressSnapshotService } from '@modules/press/snapshot/snapshotService'
import { normalizeWrittenDocument } from '@modules/press/writtenDocument'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 装配依赖：AI 层需要扩展上下文、缓存目录、索引库（提及检索）与已就绪的快照 / 路由 / 反馈出口 */
export interface AiLayerDeps {
    context: vscode.ExtensionContext
    cacheRoot: vscode.Uri
    indexDb: Database.Database
    secrets: SecretsService
    snapshotService: PressSnapshotService
    workflowRouter: WorkflowRouter
    toastService: ToastService
    /** 激活耗时打点：由入口提供，层内只在 AI 库就绪时打一次 */
    markStage: (stage: string) => void
}

/** 装配产物：通道与记账实例交给写作 / 出图 / 取名模块复用，routes 与面板服务交给面板注册 */
export interface AiLayer {
    aiProvider: AiProvider
    usageRecorder: UsageRecorder
    chat: AiChatService
    usage: AiUsageService
    mention: MentionService
    reference: ReferenceService
    namingRoutes: NamingRoutes
}

/** 装配 AI 层：打开 ai 库、建立通道与对话服务、串起取名并注册 AI 命令 */
export async function assembleAiLayer(deps: AiLayerDeps): Promise<AiLayer> {
    const { context, cacheRoot, indexDb, secrets, snapshotService } = deps
    // AI 对话：独立 ai.db 承载会话、消息与用量，避免影响索引库写入
    const aiDb = openAiDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => aiDb.close() })
    ensureAiSchema(aiDb)
    deps.markStage('AI 库就绪')
    // 用量记账与查询共用 ai.db：记账注入各 AI 入口（对话、取名、外貌、语义、画面），查询供「AI 使用量」页；
    // 积分不落本地估算，由索引从 CodeBuddy 会话记录按请求 id 回填
    const usageRecorder = new UsageRecorder(aiDb)
    // CLI 会话记录索引：用量页据此取积分，对话服务据此取本轮真实 tokens，两边共用同一份目录规则
    const cliUsage = new CliUsageIndex()
    const usage = new AiUsageService(aiDb, cliUsage)

    // AI 通道全扩展共用一份：唯一实现为 CodeBuddy
    const aiProvider = await createAiProvider(secrets)
    // 模型选择存在 globalState（配置项已移除，面板菜单是唯一入口），激活时先载入内存副本
    hydrateSelectedModel(context.globalState)
    // 站点登录态同样存 globalState：面板据此决定展示登录引导还是正常空态
    initCodebuddyLogin(context.globalState)
    // 写回前留底：把编辑器里的写回前全文交给快照服务，AI 改坏了可以回到动手前的状态
    const chat = new AiChatService(
        aiDb,
        aiProvider,
        usageRecorder,
        {
            captureBeforeWrite: (uri, content): Promise<void> =>
                snapshotService.captureChapterBeforeWrite(uri, content),
        },
        cliUsage,
        normalizeWrittenDocument,
    )
    context.subscriptions.push(chat)
    // 提及检索：与全局搜索同源（索引库），添加时由宿主查库校验路径
    const mention = new MentionService(indexDb, chat)
    // 参考资料：语料由 {存储根}/reference/*.md 驱动，只读不写，条目按行范围注入
    const reference = new ReferenceService(chat)

    registerAiCommands(context, chat, deps.workflowRouter, deps.toastService)

    // 取名：独立 naming.db 承载生成历史与收藏，词素库全部留在宿主侧；
    // 库按需打开——取名历史只有打开面板才会读，激活期不付打开与建表的磁盘开销
    const namingDb = lazyDatabase(() => {
        const namingDatabase = openNamingDatabase(cacheRoot)
        ensureNamingSchema(namingDatabase)
        return namingDatabase
    })
    context.subscriptions.push({ dispose: () => namingDb.dispose() })
    const namingService = new NamingService(namingDb.get, aiProvider, usageRecorder)
    const namingRoutes = new NamingRoutes(namingService)

    return { aiProvider, usageRecorder, chat, usage, mention, reference, namingRoutes }
}
