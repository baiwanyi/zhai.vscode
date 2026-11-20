/**
 * 扩展入口：按 common.md 第 4.2 节激活流程装配 Common 与 AI 服务。
 * 流程：日志 → 索引库 → AI/取名层 → 写作与媒体层 → 公众号层 → 面板注册 → 收尾钩子（自检后台执行）。
 * 分层：领域的装配各自成文件（./activation 下的 aiLayer、editorLayer、wechatLayer、lifecycle），本文件只做串联与错误边界。
 * 复用约定：激活结果作为扩展 exports 返回，VS Code 的 Markdown 预览读取 extendMarkdownIt 挂载图片路径插件；
 * 该钩子只需同步返回实例，真正的路径解析在渲染时按当前文档惰性计算。
 * 关键约束：重量级依赖（CodeBuddy SDK、公众号渲染链）一律惰性加载，激活期只做装配与监听注册；
 * 新增模块若引入大体积运行时，须沿用同一口径，否则每个窗口启动都要多付一次加载成本。
 */
import * as vscode from 'vscode'
import { assembleAiLayer } from './activation/aiLayer'
import { assembleEditorLayer } from './activation/editorLayer'
import { registerLifecycleHooks } from './activation/lifecycle'
import { assembleWechatLayer } from './activation/wechatLayer'
import { AiChatViewProvider } from './modules/ai/aiChatProvider'
import { addQuoteToChat } from './modules/ai/commands'
import { WorkflowRouter } from './modules/ai/workflowRouter'
import { registerCommands } from './modules/common/commands'
import { resolveCacheRoot, resolvePromptRoot, resolveStorageRoot } from './modules/common/config'
import { DashboardViewProvider } from './modules/common/dashboardProvider'
import { openIndexDatabase } from './modules/common/db/connection'
import { ensureSchema } from './modules/common/db/schema'
import { IndexService } from './modules/common/indexer/indexService'
import { lazyDatabase } from './modules/common/lazyDatabase'
import { logger } from './modules/common/logger'
import { SecretsService } from './modules/common/secrets'
import { StatusBarService } from './modules/common/statusBar'
import { createStorageDatabaseProvider } from './modules/common/storageDbProvider'
import { ToastService } from './modules/common/toastService'
import { trackActiveDocument } from './modules/editor/activeDocument'
import { AnnotationRoutes } from './modules/editor/annotationRoutes'
import { registerAnnotationWatchers } from './modules/editor/annotationWatcher'
import { closeAnnotationDatabases, openAnnotationDatabase } from './modules/editor/db/connection'
import { ImageProviderRouter } from './modules/imagegen/ai/imageProvider'
import { PressCoverService } from './modules/imagegen/coverService'
import { ImageGenerateService } from './modules/imagegen/imageGenerateService'
import { ImageSettingsService } from './modules/imagegen/imageSettingsService'
import { PortraitService } from './modules/imagegen/portraitService'
import { migrateLegacyTagDir, PromptRuleService, PromptTagService } from './modules/imagegen/prompt'
import { ReferenceImageService } from './modules/imagegen/referenceImageService'
import { zhaiImagePathPlugin, type MarkdownItLike } from './modules/markdown/zhaiImagePreview'
import { closeMediaDatabases, openMediaDatabase } from './modules/media/db/connection'
import { MediaLibraryService } from './modules/media/mediaLibraryService'
import { createMediaRecorder } from './modules/media/mediaRecorder'
import { MediaRoutes } from './modules/media/mediaRoutes'
import { PressCoverStore } from './modules/media/pressCoverStore'
import { NotebookStore } from './modules/note/notebookStore'
import { NoteRenameService } from './modules/note/noteRenameService'
import { registerNoteRenameWatcher } from './modules/note/noteRenameWatcher'
import { PinStore } from './modules/note/pinStore'
import { TrashStore } from './modules/note/trashStore'
import { openPressDatabase } from './modules/press/db/connection'
import { ImportSemanticService } from './modules/press/importSemanticService'
import { PressAiService } from './modules/press/pressAiService'
import { PressRoutes } from './modules/press/pressRoutes'
import { PressSnapshotService } from './modules/press/snapshot/snapshotService'
import { registerPressSnapshotWatcher } from './modules/press/snapshot/snapshotWatcher'
import { registerProofreadCommands } from './modules/proofread/commands'
import { ProofreadRoutes } from './modules/proofread/proofreadRoutes'
import { ProofreadService } from './modules/proofread/proofreadService'
import { StockPhotoCache } from './modules/stock/cache'
import { StockClient } from './modules/stock/client'
import { closeStockDatabases, openStockDatabase } from './modules/stock/db/connection'
import { StockLibraryService } from './modules/stock/stockLibraryService'
import { StockRoutes } from './modules/stock/stockRoutes'
import { StockService } from './modules/stock/stockService'
import { TodoRepository } from './modules/todo/todoRepository'
import { TodoRoutes } from './modules/todo/todoRoutes'
import { TodoService } from './modules/todo/todoService'
import { TodoWatcher } from './modules/todo/todoWatcher'
import { UploadRoutes } from './modules/upload/uploadRoutes'
import { UploadService } from './modules/upload/uploadService'
import { createWeiboMediaResolver } from './modules/weibo/panel'
import { createWeiboPostActions } from './modules/weibo/postActions'
import { warmWeiboMetadata } from './modules/weibo/warmup'
import { createWeiboCookieStore } from './modules/weibo/webCredential'
import { createWeiboAvatarGateway } from './modules/weibo/weiboAvatar'
import { createWeiboCache } from './modules/weibo/weiboCache'
import type { IndexStatus } from './modules/common/indexer/indexService'
import type { MarkdownEditorProvider } from './modules/editor/editorProvider'
import type { ImageReferenceInput } from './modules/imagegen/ai/imageProvider'
import type Database from 'better-sqlite3'

/** 扩展对外导出：Markdown 预览扩展在激活后读取 extendMarkdownIt 挂载自定义插件 */
export interface ZhaiExports {
    extendMarkdownIt(md: MarkdownItLike): MarkdownItLike
}

/** 挂载 Markdown 预览的图片路径插件：不依赖任何服务，激活降级时同样可用 */
function mountImagePreview(md: MarkdownItLike): void {
    zhaiImagePathPlugin(md)
}

/** 激活失败时的兜底导出：只保留 Markdown 预览钩子，其余功能由错误提示引导排查 */
const FALLBACK_EXPORTS: ZhaiExports = {
    extendMarkdownIt(md: MarkdownItLike): MarkdownItLike {
        mountImagePreview(md)
        return md
    },
}

/**
 * 激活入口：只负责错误边界与降级，装配细节见 activateExtension。
 * 关键约束：装配期任一环节抛错（缓存目录不可写、库被其它窗口写锁、旧库迁移失败）都不得让扩展
 * 整体标记为激活失败——否则命令、视图与预览钩子会一起消失；此处先释放已登记资源再返回最小导出。
 */
export async function activate(context: vscode.ExtensionContext): Promise<ZhaiExports> {
    try {
        return await activateExtension(context)
    } catch (error) {
        for (const disposable of context.subscriptions) {
            try {
                disposable.dispose()
            } catch (disposeError) {
                logger.error('激活失败后释放资源异常', disposeError)
            }
        }
        context.subscriptions.splice(0)
        logger.error('宅写作 激活失败，已降级为最小功能', error)
        logger.show()
        void vscode.window.showErrorMessage('宅写作：初始化失败，部分功能不可用，详见输出面板「宅写作」。')
        return FALLBACK_EXPORTS
    }
}

async function activateExtension(context: vscode.ExtensionContext): Promise<ZhaiExports> {
    const activateStartedAt = performance.now()
    logger.init(vscode.window.createOutputChannel('宅写作'))
    context.subscriptions.push({ dispose: () => logger.dispose() })

    // 分段耗时打点：同时给出本段增量与累计耗时，输出通道里可直接定位慢阶段（改装配顺序后对比即可）
    let lastStageAt = activateStartedAt
    const markStage = (stage: string): void => {
        const now = performance.now()
        logger.info(
            `激活阶段「${stage}」：+${String(Math.round(now - lastStageAt))}ms（累计 ${String(Math.round(now - activateStartedAt))}ms）`,
        )
        lastStageAt = now
    }

    const secrets = new SecretsService(context.secrets)

    const indexStatusEmitter = new vscode.EventEmitter<IndexStatus>()
    context.subscriptions.push(indexStatusEmitter)

    // 索引缓存目录固定为全局存储下的 zhai.vscode，与文档存储根分离
    const cacheRoot = resolveCacheRoot(context.globalStorageUri)
    const db = openIndexDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => db.close() })
    ensureSchema(db)
    markStage('索引库就绪')

    const indexService = new IndexService(db, indexStatusEmitter)
    context.subscriptions.push({ dispose: () => indexService.dispose() })

    // 操作反馈出口：命令层把执行结果推给已打开的 Webview，由前端 sonner 统一呈现
    const toastService = new ToastService()
    context.subscriptions.push(toastService)

    registerCommands(context, indexService, toastService)
    indexService.registerWatcher(context.subscriptions)

    const pinStore = new PinStore(context.globalState)
    // 笔记本偏好与回收站：与置顶同走 globalState 持久化；回收站靠索引服务恢复后重新收录
    const notebookStore = new NotebookStore(context.globalState)
    const trashStore = new TrashStore(indexService)
    // 工作流路由：汇聚活跃编辑器场景、选定模块与当前作品，供工作流面板按模块类型换页；
    // 仪表盘打开/删除作品时会同步作品选定，故先于仪表盘创建
    const workflowRouter = new WorkflowRouter(db, indexService)
    workflowRouter.register(context.subscriptions)
    const dashboardProvider = new DashboardViewProvider(
        context.extensionUri,
        db,
        indexService,
        pinStore,
        notebookStore,
        trashStore,
        indexStatusEmitter.event,
        workflowRouter,
    )

    // 微博面板：Cookie 存 SecretStorage（与公众号密钥同为系统级加密），图片缓存落 globalStorage
    dashboardProvider.attachWeiboSecrets(context.secrets, context.globalStorageUri)

    // 微博元数据预热：分组 / 账号信息 / 热搜 / 表情在激活后各取一次，落 {存储根}/weibo.json 与 weibo_avatar.jpg。
    // 不等待完成——预热自身串行执行，webClient 的 1.2s 节流依赖模块级时间戳，并发派发会让节流失效；
    // 头像走与面板同一份图片代理，预热结束后释放其连接池
    const weiboStorageRoot = resolveStorageRoot()
    const weiboCookieStore = createWeiboCookieStore(context.secrets)
    const weiboProxy = createWeiboMediaResolver(context.globalStorageUri, async (): Promise<string | undefined> =>
        weiboCookieStore.read(),
    )
    void warmWeiboMetadata({
        cookieStore: weiboCookieStore,
        cache: createWeiboCache(weiboStorageRoot),
        avatar: createWeiboAvatarGateway({
            root: weiboStorageRoot,
            resolveImage: async (imageUrl: string): Promise<string | null> => weiboProxy.resolve(imageUrl),
        }),
    }).finally((): void => {
        weiboProxy.dispose()
    })
    markStage('微博元数据预热已派发')

    // 笔记重命名：保存时让文件名跟随一级标题，避免列表标题与磁盘文件名各说一套；
    // 改的正是正在编辑的那篇时重播活跃笔记，否则列表高亮会停在已消失的旧路径上
    const noteRenameService = new NoteRenameService(indexService, pinStore, (nextPath) => {
        dashboardProvider.broadcastActiveNote(nextPath)
    })
    registerNoteRenameWatcher(noteRenameService, context.subscriptions)

    // 作品快照：设定、角色、大纲与章节正文在内容变更时按间隔自动留版，正文落在作品的 Snapshots 目录；
    // 先于 AI 对话创建，供写回前强制留底；恢复后由索引服务重建字数，两条通道共用同一套去重与节流
    const snapshotService = new PressSnapshotService(indexService)
    context.subscriptions.push(snapshotService)
    registerPressSnapshotWatcher(snapshotService, context.subscriptions)

    // 出图规则：全局共享，落 {存储根}/prompt/rules 的 md 文件，与作品无关；
    // AI 对话与出图读同一批 md，实例在此提前创建供两层共用
    const promptRuleService = new PromptRuleService()
    // 参考图：只放行选择流程登记过的本地图片，路径不经前端拼装；
    // 生图与 AI 对话共用同一份登记表，实例在此提前创建供两层共用
    const referenceImageService = new ReferenceImageService()
    // AI 与取名：ai.db 承载会话、消息与用量（首屏数据，激活期打开），naming.db 按需打开；
    // 通道、记账与写回留底在各入口间共用，AI 命令注册也在层内完成
    const ai = await assembleAiLayer({
        context,
        cacheRoot,
        indexDb: db,
        secrets,
        snapshotService,
        workflowRouter,
        toastService,
        markStage,
        // 规则正文由出图侧服务读取：ai 模块只拿回调，不反向依赖 imagegen
        readPromptRule: async (name: string): Promise<string | null> => {
            try {
                const detail = await promptRuleService.read({ name })
                return detail.content
            } catch {
                return null
            }
        },
        // 参考图同样由出图侧服务读取：登记表校验与字节读取都在那一侧，ai 模块只拿回调
        readReferenceImages: (paths: readonly string[]): Promise<ImageReferenceInput[]> =>
            referenceImageService.readForPrompt(paths),
    })

    // 微博卡片动作：保存笔记要索引能力、加入对话要 AI 会话与工作流路由，
    // 三者都在本行之前／本行之内齐备，故在 AI 层装配完成后回填给仪表盘（面板按需取值）
    dashboardProvider.attachWeiboPostActions(
        createWeiboPostActions({ indexer: indexService, chat: ai.chat, router: workflowRouter }),
    )

    // 写作管理：press.db 只承载 AI 配额等轻量状态，作品文档与人物卡仍以 Markdown 为准；
    // 库按需打开——配额与封面都要等面板请求才读，激活期不付打开与建表的磁盘开销
    const pressDb = lazyDatabase(() => openPressDatabase(cacheRoot))
    context.subscriptions.push({ dispose: () => pressDb.dispose() })
    // 封面选择记录与工作台共用 press.db：仪表盘作品列表据此显示封面（早于此处创建的仪表盘后置注入）
    const pressCoverStore = new PressCoverStore(pressDb.get)
    dashboardProvider.attachPressCoverStore(pressCoverStore)
    const pressAiService = new PressAiService(pressDb.get, ai.aiProvider, ai.usageRecorder)
    const imageRouter = new ImageProviderRouter(secrets)
    // 媒体索引：按当前存储根懒打开 {root}/sqlite/media.db，切根后由连接缓存自行重建
    const mediaDbProvider = createStorageDatabaseProvider(openMediaDatabase, cacheRoot)
    // 标注库：工作流总览页与编辑区共用同一个连接工厂，换根后由连接缓存重建
    const annotationDbProvider = createStorageDatabaseProvider(openAnnotationDatabase, cacheRoot)
    // 富文本 provider 在面板注册之后才装配，这里用闭包变量延迟取：
    // 标注跳转发生在用户点列表时，那时它一定已就绪；提前赋值会形成循环依赖
    let editorProviderRef: MarkdownEditorProvider | null = null
    const annotationRoutes = new AnnotationRoutes({
        db: annotationDbProvider,
        root: (): vscode.Uri => resolveStorageRoot(),
        revealInRich: (uri, request): boolean => editorProviderRef?.revealInPanel(uri, request) ?? false,
    })
    // 标注维护：删除置失效、改名迁移、保存后校正锚点——库方法早已就绪，此前缺的是这三个接线点
    registerAnnotationWatchers(context, annotationDbProvider)
    const portraitService = new PortraitService(mediaDbProvider)
    // 封面服务只列举候选供设定页展示：出图、设为封面与删除都在媒体页完成
    const coverService = new PressCoverService({ openDatabase: mediaDbProvider, coverStore: pressCoverStore })
    // 媒体库：列举、详情、删除、设封面、插入与复制；与封面服务共用同一份指针
    const mediaLibraryService = new MediaLibraryService({
        openDatabase: mediaDbProvider,
        coverStore: pressCoverStore,
    })
    const mediaRoutes = new MediaRoutes(mediaLibraryService)
    // 上传：独立于媒体库，落 {root}/uploads/{YYYYMM}，不写任何索引（磁盘即清单）
    const uploadRoutes = new UploadRoutes(new UploadService())
    // 在线图库：索引按当前存储根懒打开 {root}/sqlite/stock.db，密钥只从 SecretStorage 读
    const stockDbProvider = createStorageDatabaseProvider(openStockDatabase, cacheRoot)
    const stockClient = new StockClient(async (): Promise<string | undefined> => secrets.get('unsplashAccessKey'))
    const stockLibraryService = new StockLibraryService({
        openDatabase: stockDbProvider,
        resolveRoot: resolveStorageRoot,
    })
    const stockService = new StockService({
        client: stockClient,
        cache: new StockPhotoCache(),
        library: stockLibraryService,
        secrets,
        openDatabase: stockDbProvider,
    })
    const stockRoutes = new StockRoutes(stockService)
    // 图片参数：按作品覆盖，落 press/{作品名}/.zhai/image.json，配额与超时不在此管辖
    const imageSettingsService = new ImageSettingsService()
    // 出图规则服务实例在上方提前创建，此处直接复用，避免两个实例各读一份目录
    // 提示词词库：生图落 {提示词目录}/imagegen，AI 对话的写作提示词落 {提示词目录}/press，
    // 两套词库各自按分类存 md，由用户自行维护；旧的 tags 目录先整体改名，避免已有词条看不到。
    // 扩展安装目录下的样例词库不参与迁移：那是仓库内的调试资源，改名会变成对源码树的意外改动
    const promptRootPath = resolvePromptRoot().fsPath.replace(/\\/gu, '/').toLowerCase()
    const extensionPath = context.extensionUri.fsPath.replace(/\\/gu, '/').toLowerCase()
    if (!promptRootPath.startsWith(`${extensionPath}/`)) {
        await migrateLegacyTagDir()
    }
    const promptTagService = new PromptTagService('imagegen')
    const chatPromptTagService = new PromptTagService('press')
    // 统一出图入口：新图落 Images 目录，出图前叠加规则、作品级补充与负向约束，与旧入口共用同一通道与每日额度
    const imageGenerateService = new ImageGenerateService(
        pressDb.get,
        imageRouter,
        ai.usageRecorder,
        ai.aiProvider,
        imageSettingsService,
        promptRuleService,
        promptTagService,
        referenceImageService,
        // 落盘后写媒体索引：出图模块不直接依赖 media.db，由装配处注入写入器
        createMediaRecorder(mediaDbProvider),
        // 生图上下文取对话服务里的 image 作用域清单：读取即清空，与对话发送同口径
        (): Promise<string[]> => ai.chat.takeImageContextTexts(),
    )
    // 工作台读取作品列表走索引库，文档原文直接读 press/ 下的 Markdown；打开作品时同步路由事实
    // 语义归纳依赖 AI 通道，晚于仪表盘创建；人物卡、大纲与设定的按需提取共用同一实例，
    // 单任务锁与配额口径因此保持一致
    const semanticService = new ImportSemanticService(pressDb.get, ai.aiProvider, ai.usageRecorder)
    const pressRoutes = new PressRoutes({
        pressAi: pressAiService,
        portraits: portraitService,
        covers: coverService,
        indexDb: db,
        workflowRouter,
        semantic: semanticService,
        snapshot: snapshotService,
        imageGenerate: imageGenerateService,
        imageSettings: imageSettingsService,
        promptRules: promptRuleService,
        promptTags: promptTagService,
        chatPromptTags: chatPromptTagService,
        referenceImages: referenceImageService,
    })

    // 校对：本地规则检查与写回都基于编辑器内存态，写回前与 AI 写回共用同一份快照留底；
    // AI 通道与用量记账复用对话侧实例，每日次数记在 press.db 的 meta 表，与出图、取名分账
    const proofreadService = new ProofreadService({
        provider: ai.aiProvider,
        usageRecorder: ai.usageRecorder,
        db: pressDb.get,
        secrets,
        state: context.globalState,
        beforeWrite: (uri, content): Promise<void> => snapshotService.captureChapterBeforeWrite(uri, content),
    })
    const proofreadRoutes = new ProofreadRoutes(proofreadService)
    registerProofreadCommands(context, secrets, toastService)

    // 待办：清单与条目全部落在存储根 todo/ 下的 Markdown，不落库；监听只用于在文件被外部改动时提示面板刷新，
    // 写操作本身由服务按清单串行并回传完整详情，写入触发的监听事件由服务侧的静默窗口过滤掉
    const todoRepository = new TodoRepository()
    const todoService = new TodoService(todoRepository, context.globalState)
    context.subscriptions.push(todoService, new TodoWatcher(todoService, todoRepository))
    // 待办卡片落在仪表盘概览区，协议请求由仪表盘面板承接，故后置注入到仪表盘
    dashboardProvider.attachTodoRoutes(new TodoRoutes(todoService))

    // 公众号：独立 wechat.db 承载账号与推送批次，AppSecret 按账号存 SecretStorage（不入库），
    // 鉴权失效经 EventEmitter 广播给两个面板；账号协议同样由仪表盘面板承接
    const wechatLayer = assembleWechatLayer({ context, cacheRoot, indexDb: db, snapshot: snapshotService })
    dashboardProvider.attachWechatRoutes(wechatLayer.routes)
    // 封面弹窗要从生图结果、已下载的在线图片与上传清单里挑图：三套路由同样后置注入仪表盘
    dashboardProvider.attachMediaRoutes(mediaRoutes)
    dashboardProvider.attachStockRoutes(stockRoutes)
    dashboardProvider.attachUploadRoutes(uploadRoutes)
    // 仪表盘的封面、待办与公众号三组依赖都是后置注入的，全部就绪后才注册视图，
    // 避免依赖「VS Code 在 activate 返回前不会恢复视图」这一隐式前提
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, dashboardProvider),
    )
    // 鉴权失效时仪表盘与本面板都该知道：两个面板共用同一份 wechat 通道载荷
    context.subscriptions.push(
        wechatLayer.onAuthFailure((event): void => dashboardProvider.broadcastWechatState(event)),
    )

    const aiChatProvider = new AiChatViewProvider({
        extensionUri: context.extensionUri,
        chat: ai.chat,
        usage: ai.usage,
        mention: ai.mention,
        reference: ai.reference,
        contextSources: ai.contextSources,
        workflowRouter,
        naming: ai.namingRoutes,
        press: pressRoutes,
        media: mediaRoutes,
        proofread: proofreadRoutes,
        secrets,
        state: context.globalState,
        toast: toastService,
        wechat: wechatLayer.routes,
        stock: stockRoutes,
        upload: uploadRoutes,
        annotation: annotationRoutes,
    })
    context.subscriptions.push(
        aiChatProvider,
        vscode.window.registerWebviewViewProvider(AiChatViewProvider.viewId, aiChatProvider),
    )
    context.subscriptions.push(wechatLayer.onAuthFailure((event): void => aiChatProvider.broadcastWechatState(event)))
    // 仪表盘增删改卷章后通知工作流面板重读：两个面板各持一份作品草稿，
    // 结构变更不走 press 通道（那里只下发「当前文档属于哪个作品」），需要独立通知才能跟上
    dashboardProvider.attachPressWorkspaceListener((dirPath) => aiChatProvider.broadcastPressWorkspaceChanged(dirPath))
    markStage('面板注册完成')

    // 编辑器：富文本自定义编辑器与切换命令；打开动作由 modules/editor/openDocument 统一决定；
    // 注入章节快照服务，使富文本首次回写前与 AI 写回同一套留底口径；
    // 标注库按存储根懒打开，换根后由连接缓存自行重建
    // 查询复用全扩展共用的通道与记账实例，模型取当前选中模型，不新增模型入口
    editorProviderRef = assembleEditorLayer(
        context,
        snapshotService,
        annotationDbProvider,
        {
            provider: ai.aiProvider,
            usageRecorder: ai.usageRecorder,
            // 查询缓存与历史复用标注库：懒打开，首次查询时才建连接
            db: (): Database.Database => annotationDbProvider().db,
        },
        // 编辑器内的粘贴 / 拖拽上传复用同一个上传路由，落盘目录与命名口径完全一致
        uploadRoutes,
        // 块菜单「添加到 AI 对话」：块区间换算行号、上下文写入与切到对话分区都复用 AI 层现成实现
        (document, quote, blockRange) => addQuoteToChat(ai.chat, workflowRouter, document, quote, blockRange),
    )
    // 活跃文档事实源：文本与富文本切换统一由此广播，工作流路由与插入目标不再直读 activeTextEditor
    trackActiveDocument(context.subscriptions)

    const statusBar = new StatusBarService(indexService, indexStatusEmitter.event)
    statusBar.register(context.subscriptions)

    // 收尾：配置变更同步（重建连接与增量监听）、后台自检、完成日志与初始化标记
    registerLifecycleHooks({ context, indexService, activateStartedAt })

    // Markdown 预览钩子：只包装图片规则，未命中 @zhai/ 前缀时保持原生渲染
    return FALLBACK_EXPORTS
}

export function deactivate(): void {
    // 随 context.subscriptions 释放的库已由 VS Code 关闭；media / stock / 标注库是模块级连接缓存，须显式关闭
    closeMediaDatabases()
    closeStockDatabases()
    closeAnnotationDatabases()
}
