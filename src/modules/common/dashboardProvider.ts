/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合、笔记创建/打开/删除、置顶设置、
 * 工作流页跳转、待办清单读写、写作管理（作品列表、作品详情、新建作品与章节、卷的重命名与删除、
 * 章节的删除与跨卷移动、整部作品删除）聚合与创建、公众号账号的列表与增删改鉴权、
 * 媒体库、在线图库与上传清单的列举（公众号封面选图）、微博编辑区面板的打开，以及宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应按 reqId 匹配回传；
 * 另经 state 消息主动广播：note 通道给活跃笔记（列表回填选中态），index 通道给索引状态（列表随编辑收敛），
 * todo 通道给待办清单的外部改动（卡片收到即重读）；
 * press/active 请求返回当前文档所属的作品目录，供面板打开时一次性跟随到该作品的章节列表。
 * 关键约束：请求处理为异步流程（新建笔记/作品/章节、卷重命名与删除、章节删除与移动需落盘 + 索引 + 打开，
 * 打开、置顶与删除须先经索引库校验路径），
 * 批量删除按条独立处理，单条失败不阻断其余条目，失败原因随响应回传而非整单抛错；
 * 须 await 结果后再回包；命令入口一律经白名单校验，未登记的命令直接拒绝；
 * 作品协议只做入参收窄与转发，聚合/落盘由 modules/press 承担，打开路径须先按索引库回查；
 * 活跃编辑器与索引状态监听须随面板销毁释放，否则重开面板会叠加监听、重复广播。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { WorkflowRouter } from '@modules/ai/workflowRouter'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { getActiveDocument, onDidChangeActiveDocument } from '@modules/editor/activeDocument'
import type { MediaRoutes } from '@modules/media/mediaRoutes'
import type { PressCoverStore } from '@modules/media/pressCoverStore'
import {
    createNotebook,
    deleteNotebook,
    listNotebooks,
    renameNotebook,
    sortNotebooks,
} from '@modules/note/notebookService'
import type { NotebookStore } from '@modules/note/notebookStore'
import {
    assertNoteSaved,
    assertRemovableNote,
    createAndOpenNote,
    isNoteExisting,
    openNoteByPath,
} from '@modules/note/noteService'
import type { PinStore } from '@modules/note/pinStore'
import type { TrashStore } from '@modules/note/trashStore'
import { mergeChapterSummaries } from '@modules/press/chapterSummaryMerge'
import { analyzeProject } from '@modules/press/importAnalysis'
import { ImportError, PressImportService } from '@modules/press/importService'
import { appendChapterToOutline } from '@modules/press/outlineSync'
import { readOrderPrefix, toDisplayName } from '@modules/press/projectFactory'
import {
    hasProjectFile,
    hasProjectFiles,
    listPressProjects,
    listProjectChapterPaths,
    listVolumeFilePaths,
    readProjectDetail,
} from '@modules/press/projectRepository'
import {
    createChapter,
    createProject,
    createVolume,
    deleteChapter,
    deleteProject,
    deleteVolume,
    moveChapter,
    openChapterByPath,
    openProjectByDir,
    renameVolume,
} from '@modules/press/projectService'
import type { StockRoutes } from '@modules/stock/stockRoutes'
import type { TodoRoutes } from '@modules/todo/todoRoutes'
import type { UploadRoutes } from '@modules/upload/uploadRoutes'
import type { WechatRoutes } from '@modules/wechat/wechatRoutes'
import { WECHAT_DOCUMENT_METHODS } from '@modules/wechat/wechatRoutes'
import { openWeiboPanel } from '@modules/weibo'
import type { WeiboEnhancePrompt, WeiboPostActions } from '@modules/weibo'
import type { DashboardStats } from '@shared/types/dashboard'
import type { HostToWebviewMessage } from '@shared/types/messages'
import { isRequestMessage } from '@shared/types/messages'
import type {
    CreateNoteRequest,
    CreatedNote,
    DeleteNotesResult,
    NoteActiveState,
    NoteDeleteFailure,
    OpenNoteResult,
    PinNotesResult,
    SearchNotesResult,
} from '@shared/types/note'
import {
    isCreateNoteRequest,
    isDeleteNotesRequest,
    isOpenNoteRequest,
    isPinNotesRequest,
    isSearchNotesRequest,
} from '@shared/types/note'
import type {
    CreateNotebookResult,
    DeleteNotebookResult,
    ListNotebookNotesResult,
    PinNotebooksResult,
    RenameNotebookResult,
    SetNotebookOpenResult,
    SetNotebookSortResult,
} from '@shared/types/notebook'
import {
    isCreateNotebookRequest,
    isDeleteNotebookRequest,
    isListNotebookNotesRequest,
    isPinNotebooksRequest,
    isRenameNotebookRequest,
    isSetNotebookOpenRequest,
    isSetNotebookSortRequest,
} from '@shared/types/notebook'
import type {
    CreatePressProjectResult,
    CreatedPressChapter,
    CreatedPressVolume,
    DeletePressProjectResult,
    MergeChapterSummaryResult,
    MovedPressChapter,
    OpenPressProjectResult,
    PressActiveState,
    PressAnalyzeResult,
    PressImportCandidate,
    PressImportProgress,
    PressImportStartResult,
    PressProjectDetail,
    PressProjectSummary,
    RenamedPressVolume,
} from '@shared/types/press'
import {
    isCreatePressChapterRequest,
    isCreatePressProjectRequest,
    isDeletePressChapterRequest,
    isDeletePressProjectRequest,
    isDeletePressVolumeRequest,
    isMergeChapterSummaryRequest,
    isMovePressChapterRequest,
    isOpenPressChapterRequest,
    isPressAnalyzeRequest,
    isPressDirPath,
    isPressImportStartRequest,
    isRenamePressVolumeRequest,
    readPressAudience,
} from '@shared/types/press'
import type { TrashClearResult, TrashListResult, TrashPurgeResult, TrashRestoreResult } from '@shared/types/trash'
import { isTrashPurgeRequest, isTrashRestoreRequest } from '@shared/types/trash'
import type { WechatAccountAuthFailureEvent, WechatCoverPreviewResult } from '@shared/types/wechat'
import { isWechatBatchDocPath, isWechatCoverPreviewRequest } from '@shared/types/wechat'
import type { OpenWorkflowResult } from '@shared/types/workflow'
import { isOpenWorkflowRequest } from '@shared/types/workflow'
import { resolvePromptRoot, resolveStorageRoot } from './config'
import { findIndexedFile } from './db/indexRepository'
import {
    UNCLASSIFIED_NOTEBOOK_ID,
    aggregateFileStats,
    listFilesByPaths,
    listNotesByNotebook,
    listRecentFiles,
    mergePinnedFiles,
    RECENT_LIMIT,
    searchNotes,
    toNotebookId,
} from './db/statsRepository'
import { logger } from './logger'
import { buildStorageUri } from './storagePath'
import { WEBVIEW_ALLOWED_COMMANDS } from './webviewCommands'
import { buildWebviewHtml } from './webviewHtml'
import type { IndexService, IndexStatus } from './indexer/indexService'
import type Database from 'better-sqlite3'

/** 公众号后台地址：前端只传固定标识，URL 固定在此，不接受 Webview 传入任意地址 */
const WECHAT_MP_URL = 'https://mp.weixin.qq.com/'

/** 封面允许的扩展名：与素材上传口径一致，其它格式即便存在也不给 Webview 地址 */
const WECHAT_COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.dashboard'

    /** 活跃编辑器监听：面板销毁时释放，避免重开面板后监听堆积、重复广播 */
    private activeDocumentListener: vscode.Disposable | null = null
    /** 索引状态监听：面板存活期间把索引变更转给 Webview，使列表跟随文件编辑收敛 */
    private indexStatusListener: vscode.Disposable | null = null
    /** 作品导入服务：持有待导入文件 token 与进行中的任务，长任务进度经 state 通道广播 */
    private readonly importService: PressImportService
    /** 封面选择仓储：press.db 晚于仪表盘打开，故用后置注入；未注入时列表不带封面 */
    private coverStore: PressCoverStore | null = null
    /** 待办路由：后置注入，未注入时 todo/* 请求直接报未就绪，不静默返回空结果 */
    private todoRoutes: TodoRoutes | null = null
    /** 公众号路由：后置注入，未注入时 wechat/* 请求直接报未就绪，不静默返回空列表 */
    private wechatRoutes: WechatRoutes | null = null
    /** 媒体库路由：后置注入，公众号封面据此列举生图结果；未注入时 media/* 直接报未就绪 */
    private mediaRoutes: MediaRoutes | null = null
    /** 在线图库路由：后置注入，公众号封面据此列举已下载的在线图片；未注入时 stock/* 直接报未就绪 */
    private stockRoutes: StockRoutes | null = null
    /** 作品结构变更监听：后置注入，仪表盘增删改卷章后用它通知工作流面板重读 */
    private pressWorkspaceListener: ((dirPath: string) => void) | null = null
    /** AI 会话作用域清理：后置注入，删除作品时把该作品的会话归入通用对话；未注入时按 0 处理 */
    private aiScopeJanitor: { adoptScope(scope: string): number } | null = null
    /** 上传路由：后置注入，公众号封面与微博发表框据此列举 uploads 下的已上传图片；未注入时 upload/* 直接报未就绪 */
    private uploadRoutes: UploadRoutes | null = null
    /** 微博面板凭证：后置注入，未注入时面板仍可打开但 Cookie 读写不可用 */
    private weiboSecrets: vscode.SecretStorage | null = null
    /** 微博图片缓存根：图床按 Referer 放行，图片需先落本地再签发 URI */
    private weiboCacheRoot: vscode.Uri | null = null
    /** 微博卡片动作：后置注入，未注入时「保存到笔记」「添加到 AI 对话」按未就绪回包 */
    private weiboPostActions: WeiboPostActions | null = null
    /** 微博发表框 AI 优化：后置注入 AI 服务的改写能力，未注入时「AI 优化」按未登记回包 */
    private weiboEnhance: WeiboEnhancePrompt | null = null
    /** 当前面板实例：仅在挂载期间有效，用于请求之外的主动广播 */
    private view: vscode.WebviewView | null = null
    /** 待办目录变更监听：面板存活期间把外部改动转给 Webview，销毁时释放 */
    private todoListener: vscode.Disposable | null = null

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly db: Database.Database,
        private readonly indexService: IndexService,
        private readonly pins: PinStore,
        private readonly notebookStore: NotebookStore,
        private readonly trashStore: TrashStore,
        private readonly indexStatus: vscode.Event<IndexStatus>,
        private readonly workflowRouter: WorkflowRouter,
    ) {
        this.importService = new PressImportService(indexService)
    }

    /** 注入封面选择仓储：由扩展入口在 press.db 打开后调用，作品列表据此显示封面 */
    public attachPressCoverStore(store: PressCoverStore): void {
        this.coverStore = store
    }

    /** 注入 SecretStorage 与缓存根：微博 Cookie 存密钥库，图片缓存落 globalStorage */
    public attachWeiboSecrets(secrets: vscode.SecretStorage, cacheRoot: vscode.Uri): void {
        this.weiboSecrets = secrets
        this.weiboCacheRoot = cacheRoot
    }

    /**
     * 注入微博卡片动作：保存到笔记依赖索引能力、加入对话依赖 AI 会话与工作流路由，
     * 两者都在 AI 层装配完成后才齐备，故由扩展入口后置注入；未注入时对应协议方法报未就绪。
     */
    public attachWeiboPostActions(actions: WeiboPostActions): void {
        this.weiboPostActions = actions
    }

    /** 注入待办路由：由扩展入口在待办服务装配后调用，待办卡片据此读写 todo/ 下的清单 */
    public attachTodoRoutes(routes: TodoRoutes): void {
        this.todoRoutes = routes
    }

    /** 注入会话作用域清理：由扩展入口在 AI 层装配后调用，删除作品时把其会话归入通用对话 */
    public attachAiScopeJanitor(janitor: { adoptScope(scope: string): number }): void {
        this.aiScopeJanitor = janitor
    }

    /** 注入公众号路由：由扩展入口在 wechat.db 打开后调用，公众号列表页据此读写账号 */
    public attachWechatRoutes(routes: WechatRoutes): void {
        this.wechatRoutes = routes
    }

    /** 注入媒体库路由：封面弹窗要从生图结果里挑图，故转发 media/* 请求 */
    public attachMediaRoutes(routes: MediaRoutes): void {
        this.mediaRoutes = routes
    }

    /** 注入在线图库路由：封面弹窗要从已下载的在线图片里挑图，故转发 stock/* 请求 */
    public attachStockRoutes(routes: StockRoutes): void {
        this.stockRoutes = routes
    }

    /** 注入上传路由：封面弹窗要从上传页的已上传图片里挑图，故转发 upload/* 请求 */
    public attachUploadRoutes(routes: UploadRoutes): void {
        this.uploadRoutes = routes
    }

    /**
     * 注入微博发表框的 AI 改写能力：由扩展入口传 AI 服务的 enhancePrompt。
     * 关键约束：微博面板只转发 ai/enhancePrompt 一个方法，不整体接管 ai/* 前缀。
     */
    public attachWeiboEnhance(enhance: WeiboEnhancePrompt): void {
        this.weiboEnhance = enhance
    }

    /**
     * 注入作品结构变更监听：由扩展入口在 AI 对话面板装配后调用，
     * 仪表盘增删改卷章后经它通知工作流面板重读当前作品，避免两个面板各看一份旧数据。
     */
    public attachPressWorkspaceListener(listener: (dirPath: string) => void): void {
        this.pressWorkspaceListener = listener
    }

    /** 通知作品结构已变更：监听方未注入时静默跳过，工作区下次进入仍会整份重读 */
    private notifyPressWorkspaceChanged(dirPath: string): void {
        this.pressWorkspaceListener?.(dirPath)
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        // 存储根加入资源白名单：作品封面落盘后需要经 asWebviewUri 供列表缩略图加载
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                resolveStorageRoot(),
                // 提示词预览图可能落在词库目录设置指定的位置，须在此放行，否则 asWebviewUri 出的地址会被拒
                resolvePromptRoot(),
                // 兜底仓库内的词库目录：视图可能在配置就绪前创建，此时 resolvePromptRoot 取到默认值，
                // 而随后的资源请求按真实配置求值，两者对不上会让预览图一律 401；扩展目录内的这份词库无秘密
                vscode.Uri.joinPath(this.extensionUri, 'resources', 'prompt'),
            ],
        }
        void this.renderHtml(webviewView)
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => void this.handleMessage(webviewView, message),
            this,
        )
        this.watchActiveDocument(webviewView)
        this.watchIndexStatus(webviewView)
        this.watchTodoChanges(webviewView)
        // 面板实例留一份引用：鉴权失效这类被动变化要在请求之外主动推送
        this.view = webviewView
        webviewView.onDidDispose(() => {
            this.view = null
            this.stopWatchingActiveDocument()
            this.stopWatchingIndexStatus()
            this.stopWatchingTodoChanges()
        }, this)
    }

    /**
     * 广播公众号账号状态：鉴权失效发生在任意请求内部，列表页据此提示并刷新色点。
     * 关键约束：面板未挂载时直接丢弃——状态已落库，下次打开列表会自然读到最新值。
     */
    public broadcastWechatState(payload: WechatAccountAuthFailureEvent): void {
        if (this.view !== null) {
            this.post(this.view, { type: 'state', channel: 'wechat', payload })
        }
    }

    /**
     * 重播活跃笔记：笔记文件跟随标题改名后旧路径已不在索引里，列表高亮与路由归属须立刻跟到新路径。
     * 不能复用 buildActiveNote——改名不触发 onDidChangeActiveTextEditor，此刻编辑器可能仍指向旧 Uri，
     * 故由调用方直接给出重命名后的相对路径。
     * 关键约束：面板未挂载时直接丢弃，下次打开会重新请求快照。
     */
    public broadcastActiveNote(activePath: string): void {
        if (this.view !== null) {
            this.post(this.view, { type: 'state', channel: 'note', payload: { activePath, hasEditor: true } })
        }
    }

    private async renderHtml(webviewView: vscode.WebviewView): Promise<void> {
        try {
            webviewView.webview.html = await buildWebviewHtml(
                webviewView.webview,
                this.extensionUri,
                'dashboard/index.html',
            )
        } catch (error) {
            webviewView.webview.html = `<html><body><h3>宅写作</h3><p>Webview 资源缺失，请先执行 pnpm run compile（${String(error)}）</p></body></html>`
            logger.error('Webview 资源加载失败', error)
        }
    }

    private async handleMessage(view: vscode.WebviewView, message: unknown): Promise<void> {
        if (!isRequestMessage(message)) {
            logger.warn(`Webview 收到非协议消息，已忽略：${JSON.stringify(message).slice(0, 100)}`)
            return
        }
        const { reqId, method, payload } = message
        try {
            const result = await this.invoke(view, method, payload)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            // 导入类错误带业务原因码，前端据此分发提示文案；其余仍以协议方法名兜底
            const code = error instanceof ImportError ? error.code : method
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code, message: text } })
        }
    }

    private async invoke(view: vscode.WebviewView, method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'dashboard/stats': {
                return this.buildStats()
            }
            case 'note/create': {
                return this.createNote(payload)
            }
            case 'note/pin': {
                return this.setPinned(payload)
            }
            case 'note/delete': {
                return this.trashNotes(payload)
            }
            case 'note/open': {
                return this.openNote(payload)
            }
            case 'note/search': {
                return Promise.resolve(this.handleSearchNotes(payload))
            }
            case 'note/active': {
                return Promise.resolve(this.buildActiveNote())
            }
            case 'notebook/create': {
                return this.handleCreateNotebook(payload)
            }
            case 'notebook/rename': {
                return this.handleRenameNotebook(payload)
            }
            case 'notebook/delete': {
                return this.handleDeleteNotebook(payload)
            }
            case 'notebook/pin': {
                return this.setNotebooksPinned(payload)
            }
            case 'notebook/setSort': {
                return this.setNotebookSort(payload)
            }
            case 'notebook/setOpen': {
                return this.setNotebookOpen(payload)
            }
            case 'notebook/notes': {
                return Promise.resolve(this.handleNotebookNotes(payload))
            }
            case 'trash/list': {
                return this.listTrash()
            }
            case 'trash/restore': {
                return this.restoreTrash(payload)
            }
            case 'trash/purge': {
                return this.purgeTrash(payload)
            }
            case 'trash/clear': {
                return this.clearTrash()
            }
            case 'press/active': {
                return Promise.resolve(this.buildActivePressProject())
            }
            case 'weibo/open': {
                return this.openWeibo()
            }
            case 'workflow/open': {
                return this.openWorkflow(payload)
            }
            case 'workflow/selectModule': {
                return this.selectWorkflowModule(payload)
            }
            case 'wechat/cover/preview': {
                return this.previewWechatCovers(view, payload)
            }
            case 'press/projects': {
                return this.readPressProjects(view)
            }
            case 'press/detail': {
                return this.readPressDetail(payload)
            }
            case 'press/create': {
                return this.createPressProject(payload)
            }
            case 'press/createChapter': {
                return this.createPressChapter(payload)
            }
            case 'press/createVolume': {
                return this.createPressVolume(payload)
            }
            case 'press/renameVolume': {
                return this.renamePressVolume(payload)
            }
            case 'press/deleteVolume': {
                return this.deletePressVolume(payload)
            }
            case 'press/deleteChapter': {
                return this.deletePressChapter(payload)
            }
            case 'press/moveChapter': {
                return this.movePressChapter(payload)
            }
            case 'press/deleteProject': {
                return this.deletePressProject(payload)
            }
            case 'press/open': {
                return this.openPressProject(payload)
            }
            case 'press/openChapter': {
                return this.openPressChapter(payload)
            }
            case 'press/import/pick': {
                return this.pickPressImport()
            }
            case 'press/import/start': {
                return this.startPressImport(view, payload)
            }
            case 'press/import/cancel': {
                return Promise.resolve(this.cancelPressImport(payload))
            }
            case 'press/analyze': {
                return this.analyzePressMaterial(payload)
            }
            case 'press/mergeChapterSummary': {
                return this.mergePressChapterSummary(payload)
            }
            case 'host/command': {
                const command = typeof payload === 'string' ? payload : ''
                if (!WEBVIEW_ALLOWED_COMMANDS.has(command)) {
                    throw new Error(`未授权的宿主命令：${command}`)
                }
                void vscode.commands.executeCommand(command)
                return Promise.resolve({ executed: true })
            }
            case 'host/openExternal': {
                return this.openExternalPage(payload)
            }
            default: {
                // 封面选图要列举生图结果与已下载的在线图片：两套路由与工作流面板共用，仅在这里转发
                if (method.startsWith('media/')) {
                    const routes = this.mediaRoutes
                    if (routes === null) {
                        throw new Error('媒体库服务尚未就绪')
                    }
                    return routes.handle(method, payload, (uri) => view.webview.asWebviewUri(uri).toString())
                }
                if (method.startsWith('stock/')) {
                    const routes = this.stockRoutes
                    if (routes === null) {
                        throw new Error('在线图库服务尚未就绪')
                    }
                    return routes.handle(method, payload, (uri) => view.webview.asWebviewUri(uri).toString())
                }
                if (method.startsWith('upload/')) {
                    const routes = this.uploadRoutes
                    if (routes === null) {
                        throw new Error('上传服务尚未就绪')
                    }
                    return routes.handle(method, payload, (uri) => view.webview.asWebviewUri(uri).toString())
                }
                if (method.startsWith('todo/')) {
                    const routes = this.todoRoutes
                    if (routes === null) {
                        throw new Error('待办服务尚未就绪')
                    }
                    return routes.handle(method, payload)
                }
                if (method.startsWith('wechat/')) {
                    const routes = this.wechatRoutes
                    if (routes === null) {
                        throw new Error('公众号服务尚未就绪')
                    }
                    // 推送阶段经 state 通道回投给本面板：用户能看到「正在渲染 / 上传 / 提交」
                    const result = await routes.handle(method, payload, (progress) => {
                        this.post(view, { type: 'state', channel: 'wechat', payload: progress })
                    })
                    // 打开 / 新建即打开 / 导入即打开正文都会切换活跃编辑器：立即同步路由事实
                    if (WECHAT_DOCUMENT_METHODS.has(method)) {
                        this.workflowRouter.syncFromEditor()
                    }
                    return result
                }
                throw new Error(`未知的协议方法：${method}`)
            }
        }
    }

    /**
     * 组装统计快照：文件级聚合与最近更新来自索引库，笔记本列表由扫盘与索引合并，
     * 置顶与排序偏好来自宿主存储，构建状态来自索引服务。
     * 关键约束：先按扫盘结果自愈偏好，再用自愈后的偏好排序，避免失效 id 影响置顶与默认落点；
     * 统计不返回内部分组合集，笔记本条目下钻的笔记由 notebook/notes 按需读取。
     */
    private async buildStats(): Promise<DashboardStats> {
        const status = this.indexService.getStatus()
        const pinnedPaths = this.pins.list()
        // 多取置顶项数量：置顶项可能同时命中最近更新，多取的额度用于抵消这部分重复占位
        const recent = listRecentFiles(this.db, RECENT_LIMIT + pinnedPaths.length)
        const aggregate = aggregateFileStats(this.db)
        const scanned = await listNotebooks(aggregate.notebookStats, this.notebookStore)
        await this.notebookStore.prune(new Set(scanned.map((notebook) => notebook.id)))
        const prefs = this.notebookStore.readPrefs()
        const pinnedIds = new Set(this.notebookStore.listPinned())
        const ordered = sortNotebooks(scanned, prefs.sort, [...pinnedIds])
        return {
            indexedCount: aggregate.indexedCount,
            totalWords: aggregate.totalWords,
            tagCount: aggregate.tagCount,
            moduleStats: aggregate.moduleStats,
            recentFiles: mergePinnedFiles(listFilesByPaths(this.db, pinnedPaths), recent, RECENT_LIMIT),
            notebooks: ordered.map((notebook) => ({
                ...notebook,
                isPinned: pinnedIds.has(notebook.id),
                isDefault: prefs.defaultId === notebook.id,
            })),
            notebookPrefs: prefs,
            lastBuiltAt: status.lastBuiltAt,
            isRebuilding: status.isRebuilding,
        }
    }

    /** 批量设置置顶：路径先经索引库校验，仅写入真实存在的笔记，避免失效路径常驻宿主偏好 */
    private async setPinned(payload: unknown): Promise<PinNotesResult> {
        if (!isPinNotesRequest(payload)) {
            throw new Error('note/pin 参数非法：paths 须为字符串数组，isPinned 须为布尔值')
        }
        const known = new Set(listFilesByPaths(this.db, payload.paths).map((file) => file.path))
        const accepted = payload.paths.filter((path) => known.has(path))
        const pinnedPaths = await this.pins.setPinned(accepted, payload.isPinned)
        logger.info(`置顶状态更新：${payload.isPinned ? '置顶' : '取消置顶'} ${accepted.length} 项`)
        return { pinnedPaths }
    }

    /**
     * 打开笔记：以索引库中的相对路径为准，仅接受库内已登记的笔记再交由编辑器展示。
     * 安全约束：不直接采信前端传入的路径形态，先按索引库回查确认存在，从源头排除目录穿越与任意路径读取。
     */
    private async openNote(payload: unknown): Promise<OpenNoteResult> {
        if (!isOpenNoteRequest(payload)) {
            throw new Error('note/open 参数非法：path 须为非空字符串')
        }
        const [target] = listFilesByPaths(this.db, [payload.path])
        if (target === undefined) {
            throw new Error(`笔记不在索引中，无法打开：${payload.path}`)
        }
        await openNoteByPath(target.path)
        // 打开笔记后立即同步工作流事实：菜单不等编辑器事件，避免与后续请求抢时序
        this.workflowRouter.syncFromEditor()
        return { opened: true }
    }

    /**
     * 批量删除笔记：先按索引库回查确认归属，再逐条移入应用内回收站并收敛索引与置顶偏好。
     * 安全约束：不采信 Webview 传入的任意路径形态，未在索引库登记（或不属于 notes/ 目录）的路径一律拒绝，
     * 从源头排除目录穿越与越权删除；路径重复项先去重，避免同一文件产生无意义的失败提示。
     * 关键约束：单条失败不阻断其余条目，失败原因随响应回传，由前端逐条提示；
     * 置顶偏好只清理真正移走的路径；移走的正是当前打开的文档时顺手关闭其标签页，
     * 否则编辑器会停在一个已被搬走的文件上继续编辑。
     */
    private async trashNotes(payload: unknown): Promise<DeleteNotesResult> {
        if (!isDeleteNotesRequest(payload)) {
            throw new Error('note/delete 参数非法：paths 须为非空字符串数组')
        }
        const targets = [...new Set(payload.paths)]
        const indexed = new Map(listFilesByPaths(this.db, targets).map((file) => [file.path, file]))
        const trashedPaths: string[] = []
        const failures: NoteDeleteFailure[] = []
        for (const target of targets) {
            const known = indexed.get(target)
            if (known === undefined) {
                failures.push({ path: target, message: `笔记不在索引中，无法删除：${target}` })
                continue
            }
            try {
                const segments = assertRemovableNote(target)
                const uri = buildStorageUri(resolveStorageRoot(), segments)
                if (!(await isNoteExisting(target))) {
                    throw new Error(`笔记文件不存在，可能已被移除：${target}`)
                }
                assertNoteSaved(uri, target)
                const notebookId = toNotebookId(target)
                await this.trashStore.moveToTrash({
                    indexPath: target,
                    notebookId,
                    notebookName: notebookId.split('/')[1] ?? notebookId,
                    title: known.title,
                })
                this.indexService.removeFile(target)
                trashedPaths.push(target)
            } catch (cause) {
                failures.push({ path: target, message: cause instanceof Error ? cause.message : String(cause) })
            }
        }
        if (trashedPaths.length > 0) {
            await this.pins.setPinned(trashedPaths, false)
            void this.closeTabsForPaths(trashedPaths)
            logger.info(
                `笔记移入回收站完成：成功 ${String(trashedPaths.length)} 项，失败 ${String(failures.length)} 项`,
            )
        }
        return { trashedPaths, failures }
    }

    /**
     * 新建笔记：可指定落点笔记本，未指定时取默认落点，仍无默认则落未分类。
     * 安全约束：落点 id 由 noteFactory 的目录收窄统一校验，非法形态不会拼到存储根之外。
     */
    private async createNote(payload: unknown): Promise<CreatedNote> {
        if (!isCreateNoteRequest(payload)) {
            throw new Error('note/create 参数非法：notebookId 须为合法笔记本 id')
        }
        const request: CreateNoteRequest = payload ?? {}
        const directory = request.notebookId ?? this.notebookStore.readPrefs().defaultId ?? UNCLASSIFIED_NOTEBOOK_ID
        const created = await createAndOpenNote(this.indexService, directory)
        // 新建即打开：与 note/open 同口径，立即把工作流菜单切到笔记归属
        this.workflowRouter.syncFromEditor()
        return created
    }

    /** 新建笔记本：建好后若尚无默认落点则设为默认，并自动展开，避免建完看不见 */
    private async handleCreateNotebook(payload: unknown): Promise<CreateNotebookResult> {
        if (!isCreateNotebookRequest(payload)) {
            throw new Error('notebook/create 参数非法：name 须为非空字符串')
        }
        const notebook = await createNotebook(payload.name)
        const prefs = this.notebookStore.readPrefs()
        const shouldBecomeDefault = prefs.defaultId === null
        if (shouldBecomeDefault) {
            await this.notebookStore.setDefault(notebook.id)
        }
        await this.notebookStore.setOpen([...new Set([...prefs.openIds, notebook.id])])
        logger.info(`笔记本已创建并展开：${notebook.id}`)
        return { notebook: { ...notebook, isDefault: shouldBecomeDefault } }
    }

    /** 重命名笔记本：目录整体改名并重建索引，置顶与偏好随之迁移 */
    private async handleRenameNotebook(payload: unknown): Promise<RenameNotebookResult> {
        if (!isRenameNotebookRequest(payload)) {
            throw new Error('notebook/rename 参数非法：id 须为合法笔记本 id，name 须为非空字符串')
        }
        const renamed = await renameNotebook(
            { indexer: this.indexService, pins: this.pins, prefStore: this.notebookStore },
            payload.id,
            payload.name,
        )
        return renamed
    }

    /**
     * 删除笔记本：目录内笔记逐条移入回收站后才移除空目录。
     * 关键约束：默认落点被删后偏好回落 null，这里补回未分类，保证下一次新建笔记仍有落点；
     * 存在失败条目时目录保留，由前端把失败原因逐条提示。
     */
    private async handleDeleteNotebook(payload: unknown): Promise<DeleteNotebookResult> {
        if (!isDeleteNotebookRequest(payload)) {
            throw new Error('notebook/delete 参数非法：id 须为合法笔记本 id')
        }
        const result = await deleteNotebook(
            {
                indexer: this.indexService,
                pins: this.pins,
                prefStore: this.notebookStore,
                trash: this.trashStore,
            },
            payload.id,
        )
        if (result.deleted && this.notebookStore.readPrefs().defaultId === null) {
            await this.notebookStore.setDefault(UNCLASSIFIED_NOTEBOOK_ID)
        }
        return result
    }

    /** 批量设置笔记本置顶：只接受磁盘上真实存在的目录，避免失效 id 常驻偏好 */
    private async setNotebooksPinned(payload: unknown): Promise<PinNotebooksResult> {
        if (!isPinNotebooksRequest(payload)) {
            throw new Error('notebook/pin 参数非法：ids 须为笔记本 id 数组，isPinned 须为布尔值')
        }
        const aggregate = aggregateFileStats(this.db)
        const scanned = await listNotebooks(aggregate.notebookStats, this.notebookStore)
        const known = new Set(scanned.map((notebook) => notebook.id))
        const accepted = payload.ids.filter((id) => known.has(id))
        const pinnedIds = await this.notebookStore.setPinned(accepted, payload.isPinned)
        logger.info(`笔记本置顶更新：${payload.isPinned ? '置顶' : '取消置顶'} ${String(accepted.length)} 项`)
        return { pinnedIds }
    }

    /** 切换笔记本排序方式：偏好落库后由前端重新拉取快照 */
    private async setNotebookSort(payload: unknown): Promise<SetNotebookSortResult> {
        if (!isSetNotebookSortRequest(payload)) {
            throw new Error('notebook/setSort 参数非法：sort 须为 name 或 mtime')
        }
        return { sort: await this.notebookStore.setSort(payload.sort) }
    }

    /** 覆盖已展开的笔记本集合：整表可信，不做增量合并 */
    private async setNotebookOpen(payload: unknown): Promise<SetNotebookOpenResult> {
        if (!isSetNotebookOpenRequest(payload)) {
            throw new Error('notebook/setOpen 参数非法：ids 须为笔记本 id 数组')
        }
        return { openIds: await this.notebookStore.setOpen(payload.ids) }
    }

    /** 跨笔记本搜索：命中项按 mtime 倒序，置顶项仍排在结果最前，条数上限收窄到 200 */
    private handleSearchNotes(payload: unknown): SearchNotesResult {
        if (!isSearchNotesRequest(payload)) {
            throw new Error('note/search 参数非法：query 须为非空字符串')
        }
        const limit = Math.min(payload.limit ?? 100, 200)
        const rows = searchNotes(this.db, payload.query, limit)
        const rowPaths = new Set(rows.map((row) => row.path))
        const pinnedPaths = this.pins.list().filter((path) => rowPaths.has(path))
        return { items: mergePinnedFiles(listFilesByPaths(this.db, pinnedPaths), rows, limit) }
    }

    /** 读取某个笔记本下的笔记：组内置顶项排在最前，条数上限收窄到 500 */
    private handleNotebookNotes(payload: unknown): ListNotebookNotesResult {
        if (!isListNotebookNotesRequest(payload)) {
            throw new Error('notebook/notes 参数非法：id 须为合法笔记本 id')
        }
        const limit = Math.min(payload.limit ?? 100, 500)
        const rows = listNotesByNotebook(this.db, payload.id, limit)
        const rowPaths = new Set(rows.map((row) => row.path))
        const pinnedPaths = this.pins.list().filter((path) => rowPaths.has(path))
        return { items: mergePinnedFiles(listFilesByPaths(this.db, pinnedPaths), rows, limit) }
    }

    /** 读取回收站列表：条目已按删除时间倒序，损坏记录由仓储跳过 */
    private async listTrash(): Promise<TrashListResult> {
        return { items: await this.trashStore.list() }
    }

    /** 恢复回收站条目：落点由仓储按原笔记本决定，恢复后立即重新索引 */
    private async restoreTrash(payload: unknown): Promise<TrashRestoreResult> {
        if (!isTrashRestoreRequest(payload)) {
            throw new Error('trash/restore 参数非法：ids 须为回收站条目 id 数组')
        }
        const result = await this.trashStore.restore(payload.ids)
        logger.info(
            `回收站恢复完成：成功 ${String(result.restored.length)} 项，失败 ${String(result.failures.length)} 项`,
        )
        return result
    }

    /** 彻底清除回收站条目：不再进系统回收站，与首次删除语义严格区分 */
    private async purgeTrash(payload: unknown): Promise<TrashPurgeResult> {
        if (!isTrashPurgeRequest(payload)) {
            throw new Error('trash/purge 参数非法：ids 须为回收站条目 id 数组')
        }
        return this.trashStore.purge(payload.ids)
    }

    /** 清空回收站：逐条彻底删除，失败条数随结果回传 */
    private async clearTrash(): Promise<TrashClearResult> {
        return this.trashStore.clear()
    }

    /**
     * 关闭指向已移走笔记的标签页：文件搬进回收站后旧 Uri 已失效，
     * 编辑器留在上面会让用户以为还能继续编辑；只关普通文本与富文本标签，不动差异视图以外的页签。
     */
    private async closeTabsForPaths(indexPaths: string[]): Promise<void> {
        const root = resolveStorageRoot()
        const targets = new Set(
            indexPaths.map((indexPath) => buildStorageUri(root, indexPath.split('/')).fsPath.toLowerCase()),
        )
        const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
        const matched = tabs.filter((tab) => {
            const input = tab.input
            if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
                return targets.has(input.uri.fsPath.toLowerCase())
            }
            if (input instanceof vscode.TabInputTextDiff) {
                return targets.has(input.modified.fsPath.toLowerCase())
            }
            return false
        })
        if (matched.length > 0) {
            await vscode.window.tabGroups.close(matched, true)
        }
    }

    /**
     * 打开固定外部页面：前端只传标识，URL 由宿主解析。
     * 安全约束：不接受任意 URL，避免 Webview 借本协议打开不可信地址；新增页面须在此登记常量。
     */
    private async openExternalPage(payload: unknown): Promise<{ opened: boolean }> {
        if (payload !== 'wechatMp') {
            throw new Error('host/openExternal 参数不正确：仅支持固定页面标识')
        }
        return { opened: await vscode.env.openExternal(vscode.Uri.parse(WECHAT_MP_URL)) }
    }

    /**
     * 跳转工作流页：模块意图交给宿主命令设置，场景判定统一由 WorkflowRouter 完成，本层只做转发。
     * 安全约束：模块标识按小写字母数字连字符收窄，从源头排除路径形态字符串流入命令参数。
     */
    private async openWorkflow(payload: unknown): Promise<OpenWorkflowResult> {
        if (!isOpenWorkflowRequest(payload)) {
            throw new Error('workflow/open 参数非法：module 须为非空模块键')
        }
        await vscode.commands.executeCommand('zhai.openAiChat', { module: payload.module })
        return { opened: true }
    }

    /**
     * 打开微博面板：在编辑区创建独立 webview 页，已打开则聚焦同一页。
     * 关键约束：与 workflow/open 不同，这里不切换侧栏模块、不改写仪表盘路由，只是新开一个编辑区页。
     */
    private async openWeibo(): Promise<{ opened: boolean }> {
        await openWeiboPanel(
            this.extensionUri,
            this.weiboSecrets ?? undefined,
            this.weiboCacheRoot ?? undefined,
            this.weiboPostActions ?? undefined,
            this.uploadRoutes ?? undefined,
            this.weiboEnhance ?? undefined,
            this.mediaRoutes ?? undefined,
            this.stockRoutes ?? undefined,
        )
        return { opened: true }
    }

    /**
     * 本地封面转 Webview 地址：Webview 受 CSP 限制不能直接加载 file://，须经 asWebviewUri 转换。
     * 关键约束：只接受存储根内的 jpg/png 且文件真实存在，越界、格式不符与不存在的路径一律略过，
     * 界面对缺失项回落占位图；返回键是请求时的原样路径，便于前端直接按文章里的写法取用。
     */
    private async previewWechatCovers(view: vscode.WebviewView, payload: unknown): Promise<WechatCoverPreviewResult> {
        if (!isWechatCoverPreviewRequest(payload)) {
            throw new Error('wechat/cover/preview 参数非法：paths 须为 1~20 个非空路径')
        }
        const root = resolveStorageRoot()
        const uris: Record<string, string> = {}
        for (const item of payload.paths) {
            if (!WECHAT_COVER_EXTENSIONS.has(path.extname(item).toLowerCase())) {
                continue
            }
            const uri = path.isAbsolute(item) ? vscode.Uri.file(item) : buildStorageUri(root, item.split('/'))
            const relative = path.relative(root.fsPath, uri.fsPath)
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                continue
            }
            try {
                await vscode.workspace.fs.stat(uri)
            } catch {
                continue
            }
            uris[item] = view.webview.asWebviewUri(uri).toString()
        }
        return { uris }
    }

    /**
     * 只选定模块、不聚焦面板：仪表盘进入公众号页时调用，让工作流侧栏出现公众号六分区。
     * 关键约束：与 workflow/open 的唯一区别是不执行 zhai.workflow.focus——
     * 用户在仪表盘里点开公众号页时不该被抢走焦点，否则刚点开的页面立刻失去层级。
     */
    private async selectWorkflowModule(payload: unknown): Promise<{ selected: boolean }> {
        if (!isOpenWorkflowRequest(payload)) {
            throw new Error('workflow/selectModule 参数非法：module 须为非空模块键')
        }
        await vscode.commands.executeCommand('zhai.workflow.selectModule', payload.module)
        return { selected: true }
    }

    /**
     * 新建作品：作品名与目标读者先经收窄（目标读者非法回落默认值），落盘与索引由 press 服务完成；
     * 创建成功后直接打开 README，让用户立刻补充背景与风格设定。
     * 安全约束：作品名在 press 服务内再做白名单校验，本层不放行任何路径形态字符串。
     */
    private async createPressProject(payload: unknown): Promise<CreatePressProjectResult> {
        if (!isCreatePressProjectRequest(payload)) {
            throw new Error('press/create 参数非法：name 须为非空字符串')
        }
        const created = await createProject(this.indexService, {
            name: payload.name,
            audience: readPressAudience(payload.audience),
        })
        await openProjectByDir(created.dirPath)
        this.workflowRouter.selectProject(created.dirPath)
        logger.info(`作品创建完成并打开：${created.dirPath}`)
        return { dirPath: created.dirPath, title: created.title }
    }

    /**
     * 作品列表：索引库聚合出摘要后，按封面仓储记录补上 webview 可用的封面 URL。
     * 关键约束：封面文件可能已被手工删除，stat 失败时只返回无封面摘要，不产生破图；
     * 未注入封面仓储（AI 通道初始化前的早期请求）时退回纯索引结果。
     */
    private async readPressProjects(view: vscode.WebviewView): Promise<PressProjectSummary[]> {
        const projects = listPressProjects(this.db)
        const store = this.coverStore
        if (store === null) {
            return projects
        }
        return Promise.all(
            projects.map(async (project) => {
                const coverPath = store.read(project.dirPath)
                if (coverPath === null) {
                    return project
                }
                const uri = buildStorageUri(resolveStorageRoot(), coverPath.split('/'))
                try {
                    await vscode.workspace.fs.stat(uri)
                } catch {
                    return project
                }
                return { ...project, coverUrl: view.webview.asWebviewUri(uri).toString() }
            }),
        )
    }

    /**
     * 读取作品详情：作品摘要与卷分组章节由仓储一次聚合，前端据此渲染目录。
     * 关键约束：目录形态与存在性双重校验，作品未登记时给出明确错误而非空详情，避免前端误判为「无章节」。
     */
    private readPressDetail(payload: unknown): Promise<PressProjectDetail> {
        if (!isPressDirPath(payload)) {
            throw new Error('press/detail 参数非法：dirPath 须为非空字符串')
        }
        const detail = readProjectDetail(this.db, payload.dirPath)
        if (detail === null) {
            throw new Error(`作品不在索引中：${payload.dirPath}`)
        }
        return Promise.resolve(detail)
    }

    /**
     * 新建章节：章节落点与序号由 press 服务按索引库口径推导，创建后立即打开供用户续写。
     * 关键约束：先回查作品存在，避免向不存在的作品目录写入文件；返回落点卷名供前端提示；
     * 章节落盘后同步补写到大纲，使大纲列表不需要再靠人工对照作品列表。
     */
    private async createPressChapter(payload: unknown): Promise<CreatedPressChapter> {
        if (!isCreatePressChapterRequest(payload)) {
            throw new Error('press/createChapter 参数非法：dirPath 须为非空字符串，volumeDir 若传须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法新增章节：${payload.dirPath}`)
        }
        const created = await createChapter(this.indexService, {
            dirPath: payload.dirPath,
            chapterPaths: listProjectChapterPaths(this.db, payload.dirPath),
            volumeDir: payload.volumeDir,
        })
        await this.syncChapterToOutline(payload.dirPath, created.path)
        await openChapterByPath(created.path)
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`章节创建完成并打开：${created.path}`)
        return { path: created.path, title: created.title, volume: created.volume }
    }

    /**
     * 新建卷：卷序号与首章由 press 服务生成，创建后打开首章供用户续写。
     * 关键约束：建卷必然带首章——索引库只记录文档，空卷不会出现在详情页；
     * 返回卷目录与首章信息，供前端展开该卷并提示落点；首章同样以整卷块的形式补进大纲。
     */
    private async createPressVolume(payload: unknown): Promise<CreatedPressVolume> {
        if (!isPressDirPath(payload)) {
            throw new Error('press/createVolume 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法新建卷：${payload.dirPath}`)
        }
        const created = await createVolume(this.indexService, {
            dirPath: payload.dirPath,
            chapterPaths: listProjectChapterPaths(this.db, payload.dirPath),
        })
        await this.syncChapterToOutline(payload.dirPath, created.chapterPath)
        await openChapterByPath(created.chapterPath)
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`卷创建完成并打开首章：${created.chapterPath}`)
        return {
            volumeDir: created.volumeDir,
            volumeName: created.volumeName,
            chapterPath: created.chapterPath,
            chapterTitle: created.chapterTitle,
        }
    }

    /**
     * 把刚落盘的章节补写进大纲：卷目录取章节路径里的卷段，章序取文件名序号。
     * 关键约束：单向同步，只补新增、不删不改；同步失败只记日志，
     * 章节文件已经写盘并会进索引，不能因为大纲补写失败让创建操作整体失败。
     */
    private async syncChapterToOutline(dirPath: string, chapterPath: string): Promise<void> {
        const segments = chapterPath.split('/')
        const fileName = segments[segments.length - 1] ?? ''
        // 分卷章节形如 press/{作品}/Chapters/{卷}/{章}.md，四段路径是没有卷的历史散章
        const volumeDir = segments.length > 4 ? (segments[3] ?? '') : ''
        try {
            await appendChapterToOutline(dirPath, {
                volumeDir,
                order: readOrderPrefix(fileName) ?? 1,
                title: toDisplayName(fileName),
            })
        } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause)
            logger.warn(`大纲同步失败（章节已创建）：${dirPath}（${detail}）`)
        }
    }

    /**
     * 重命名卷：新卷名与序号前缀由 press 服务决定，目录移动后按新路径重建索引。
     * 关键约束：先回查作品存在，并把该卷已登记的文档一并交给服务，避免重命名后索引缺章；
     * 卷目录名在服务侧再做单段校验，本层只做非空收窄。
     */
    private async renamePressVolume(payload: unknown): Promise<RenamedPressVolume> {
        if (!isRenamePressVolumeRequest(payload)) {
            throw new Error('press/renameVolume 参数非法：dirPath、volumeDir 与 name 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法重命名卷：${payload.dirPath}`)
        }
        const renamed = await renameVolume(this.indexService, {
            dirPath: payload.dirPath,
            volumeDir: payload.volumeDir,
            name: payload.name,
            volumeFilePaths: listVolumeFilePaths(this.db, payload.dirPath, payload.volumeDir),
        })
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`卷重命名完成：${payload.volumeDir} → ${renamed.volumeDir}`)
        return renamed
    }

    /**
     * 删除卷：整卷移入回收站并清理该卷的索引记录。
     * 关键约束：先回查作品存在再触达文件系统；删除不可撤销（回收站可恢复），确认交互由前端承担；
     * 作品下已无卷时无需补建，下次新增章节会回落到自动创建的默认卷。
     */
    private async deletePressVolume(payload: unknown): Promise<{ deleted: boolean }> {
        if (!isDeletePressVolumeRequest(payload)) {
            throw new Error('press/deleteVolume 参数非法：dirPath 与 volumeDir 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法删除卷：${payload.dirPath}`)
        }
        await deleteVolume(this.indexService, { dirPath: payload.dirPath, volumeDir: payload.volumeDir })
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`卷删除完成：${payload.dirPath}/${payload.volumeDir}`)
        return { deleted: true }
    }

    /**
     * 删除章节：单章移入回收站并清理索引记录。
     * 关键约束：先按索引库回查该文档，不采信前端传入的任意路径；存在未保存修改时由服务侧拒绝，
     * 删除不可撤销（回收站可恢复），确认交互由前端承担。
     */
    private async deletePressChapter(payload: unknown): Promise<{ deleted: boolean }> {
        if (!isDeletePressChapterRequest(payload)) {
            throw new Error('press/deleteChapter 参数非法：dirPath 与 path 须为非空字符串')
        }
        if (!hasProjectFile(this.db, payload.path)) {
            throw new Error(`章节不在索引中，无法删除：${payload.path}`)
        }
        await deleteChapter(this.indexService, { dirPath: payload.dirPath, path: payload.path })
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`章节删除完成：${payload.path}`)
        return { deleted: true }
    }

    /**
     * 移动章节：目标卷与作品已登记的章节路径一并交给服务，由服务按目标卷重排序号。
     * 关键约束：先回查该文档在索引库中，避免把任意路径挪进作品目录；目标卷须真实存在，服务侧再做单段校验。
     */
    private async movePressChapter(payload: unknown): Promise<MovedPressChapter> {
        if (!isMovePressChapterRequest(payload)) {
            throw new Error('press/moveChapter 参数非法：dirPath 与 path 须为非空字符串，targetVolumeDir 须为字符串')
        }
        if (!hasProjectFile(this.db, payload.path)) {
            throw new Error(`章节不在索引中，无法移动：${payload.path}`)
        }
        const moved = await moveChapter(this.indexService, {
            dirPath: payload.dirPath,
            path: payload.path,
            targetVolumeDir: payload.targetVolumeDir,
            chapterPaths: listProjectChapterPaths(this.db, payload.dirPath),
        })
        this.notifyPressWorkspaceChanged(payload.dirPath)
        logger.info(`章节移动完成：${payload.path} → ${moved.path}`)
        return { path: moved.path, title: moved.title, volume: moved.volume }
    }

    /**
     * 打开章节：先按索引库回查该文档，仅认可已登记的章节路径再交由编辑器展示。
     * 安全约束：不直接采信前端传入的路径，避免通过详情页读取任意文件。
     */
    private async openPressChapter(payload: unknown): Promise<{ opened: boolean }> {
        if (!isOpenPressChapterRequest(payload)) {
            throw new Error('press/openChapter 参数非法：path 须为非空字符串')
        }
        if (!hasProjectFile(this.db, payload.path)) {
            throw new Error(`章节不在索引中，无法打开：${payload.path}`)
        }
        await openChapterByPath(payload.path)
        // 打开章节会把活跃编辑器切到作品内：立即同步归属，从笔记/公众号页跳进来时菜单也要跟上
        this.workflowRouter.syncFromEditor()
        return { opened: true }
    }

    /**
     * 选择导入文件：宿主弹原生文件选择框并完成安全校验与试解析，用户取消时返回 null。
     * 安全约束：源文件绝对路径不下发前端，改由导入服务签发 token，启动时凭 token 换回路径。
     */
    private async pickPressImport(): Promise<PressImportCandidate | null> {
        return this.importService.pick()
    }

    /**
     * 启动导入：立即回传 jobId，进度与终态经 press-import 通道广播。
     * 关键约束：不 await 任务本体，避免大文件解析撑爆请求超时；
     * 导入失败时把业务原因码一并广播，前端据此分发提示文案。
     */
    private startPressImport(view: vscode.WebviewView, payload: unknown): Promise<PressImportStartResult> {
        if (!isPressImportStartRequest(payload)) {
            throw new Error('press/import/start 参数非法：token 与作品名须为非空字符串')
        }
        const jobId = `job-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
        const emit = (progress: PressImportProgress): void => {
            this.post(view, { type: 'state', channel: 'press-import', payload: progress })
        }
        void this.importService
            .start(jobId, payload.token, payload.name, readPressAudience(payload.audience), emit)
            .then((outcome) => {
                emit({
                    jobId,
                    status: outcome.status,
                    done: outcome.done,
                    total: outcome.total,
                    writtenChars: outcome.writtenChars,
                    failedChapters: outcome.failedChapters,
                    dirPath: outcome.dirPath,
                    ...(outcome.code === undefined ? {} : { code: outcome.code }),
                    message: outcome.message,
                })
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                logger.error(`导入任务异常：${jobId}`, error)
                emit({
                    jobId,
                    status: 'failed',
                    done: 0,
                    total: 0,
                    writtenChars: 0,
                    failedChapters: 0,
                    dirPath: '',
                    code: error instanceof ImportError ? error.code : 'internal',
                    message,
                })
            })
        return Promise.resolve({ jobId })
    }

    /** 取消导入：按 jobId 匹配，避免上一次任务的取消请求误停当前任务 */
    private cancelPressImport(payload: unknown): { cancelled: boolean } {
        const jobId =
            typeof payload === 'object' && payload !== null ? (payload as { jobId?: unknown }).jobId : undefined
        if (typeof jobId !== 'string' || jobId.length === 0) {
            throw new Error('press/import/cancel 参数非法：jobId 须为非空字符串')
        }
        return this.importService.cancel(jobId)
    }

    /**
     * 抽取作品素材：扫描章节文档，在 Materials/ 下重写章节清单、三段摘录、人名候选与出场原文、
     * 金手指候选章与世界构建候选章。
     * 关键约束：纯本地统计、不调用模型，因此不占 AI 配额，也不依赖登录态；
     * 作品目录先按索引库回查，不采信前端路径；抽取为覆盖写入，重复执行得到最新结果。
     */
    private async analyzePressMaterial(payload: unknown): Promise<PressAnalyzeResult> {
        if (!isPressAnalyzeRequest(payload)) {
            throw new Error('press/analyze 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法抽取素材：${payload.dirPath}`)
        }
        const result = await analyzeProject(payload.dirPath)
        return {
            chapterCount: result.chapterCount,
            characterCount: result.characterCount,
            goldenFingerHits: result.goldenFingerHits,
            settingClueCount: result.settingClueCount,
        }
    }

    /**
     * 回填章节摘要：把 Materials/summaries.tsv 的摘要按 index.tsv 的路径写回大纲「计划梗概」。
     * 关键约束：只补空不覆盖——章节已有摘要时跳过，因此不需要写入前留版；
     * 章节路径取自索引库，不采信前端；单章失败只计数不中断，仅在没有可回填摘要时以结论文案说明。
     */
    private async mergePressChapterSummary(payload: unknown): Promise<MergeChapterSummaryResult> {
        if (!isMergeChapterSummaryRequest(payload)) {
            throw new Error('press/mergeChapterSummary 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法回填摘要：${payload.dirPath}`)
        }
        const result = await mergeChapterSummaries({
            dirPath: payload.dirPath,
            chapterPaths: listProjectChapterPaths(this.db, payload.dirPath),
            indexer: this.indexService,
        })
        logger.info(`章节摘要回填完成：${payload.dirPath}，${result.message}`)
        return result
    }

    /**
     * 打开作品：先按索引库回查该目录下是否登记过文档，仅认可真实存在的作品再交由编辑器展示。
     * 打开后同步工作台的作品选定，使侧栏写作页立即切到该作品（不依赖编辑器焦点是否已落到作品文档）。
     * 安全约束：不直接采信前端传入的路径形态，与 note/open 同口径，从源头排除任意目录读取。
     */
    private async openPressProject(payload: unknown): Promise<OpenPressProjectResult> {
        if (!isPressDirPath(payload)) {
            throw new Error('press/open 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法打开：${payload.dirPath}`)
        }
        await openProjectByDir(payload.dirPath)
        this.workflowRouter.selectProject(payload.dirPath)
        return { opened: true }
    }

    /**
     * 删除作品：整部作品移入回收站（不可用时降级永久删除）并清理索引，确认交互由前端承担。
     * 关键约束：先按索引库回查目录下是否登记过文档，不采信前端路径；删除成功后清空工作台的当前作品，
     * 避免侧栏写作页停留在已删除的作品上；降级结果须随回包给出，前端据此提示是否还能从回收站恢复。
     */
    private async deletePressProject(payload: unknown): Promise<DeletePressProjectResult> {
        if (!isDeletePressProjectRequest(payload)) {
            throw new Error('press/deleteProject 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法删除：${payload.dirPath}`)
        }
        const outcome = await deleteProject(this.indexService, { dirPath: payload.dirPath })
        // 作品目录已删：把该作品（含旧版按章建立的）会话归入通用对话，避免留下打不开的孤儿会话
        const adoptedConversations = this.aiScopeJanitor?.adoptScope(payload.dirPath) ?? 0
        this.workflowRouter.clearProject()
        logger.info(`作品删除完成：${payload.dirPath}`)
        return { deleted: true, permanent: outcome === 'permanent', adoptedConversations }
    }

    /**
     * 监听编辑器焦点变化并广播当前文档：note 通道供笔记列表回填选中态，press 通道供仪表盘同步到当前作品。
     * 列表选中态以编辑器真实焦点为准，而非仅记录最后一次点击，使用户关闭当前笔记后能跟随 VSCode 的焦点回退自动切回上一篇。
     * 关键约束：注册前先释放旧监听，面板销毁时一并清理，避免 WebviewView 重建后重复广播；
     * 两条广播共用同一次焦点事件，press 侧在 webview 抢焦点时按活动标签页回落，不依赖 activeTextEditor 是否存在。
     */
    private watchActiveDocument(view: vscode.WebviewView): void {
        this.stopWatchingActiveDocument()
        // 订阅统一事实源而不是 onDidChangeActiveTextEditor：切到富文本 tab 时后者不触发，
        // 仪表盘的笔记高亮与作品跟随就会停在上一份文档
        this.activeDocumentListener = onDidChangeActiveDocument(() => {
            this.post(view, { type: 'state', channel: 'note', payload: this.buildActiveNote() })
            this.post(view, { type: 'state', channel: 'press', payload: this.buildActivePressProject() })
        })
    }

    /** 释放活跃编辑器监听 */
    private stopWatchingActiveDocument(): void {
        this.activeDocumentListener?.dispose()
        this.activeDocumentListener = null
    }

    /**
     * 监听索引状态并转发给 Webview：编辑保存笔记后索引会收敛，面板据此刷新列表与标题，避免与磁盘内容脱节。
     * 关键约束：仅在面板存活期间订阅，销毁时释放，避免面板重开后叠加监听。
     */
    private watchIndexStatus(view: vscode.WebviewView): void {
        this.stopWatchingIndexStatus()
        this.indexStatusListener = this.indexStatus((status) => {
            this.post(view, { type: 'state', channel: 'index', payload: status })
        })
    }

    /** 释放索引状态监听 */
    private stopWatchingIndexStatus(): void {
        this.indexStatusListener?.dispose()
        this.indexStatusListener = null
    }

    /**
     * 监听待办变更并转发给 Webview：todo 目录被编辑器改动后，卡片按需重读清单。
     * 关键约束：仅在面板存活期间订阅，销毁时释放，避免面板重开后叠加监听；
     * 待办路由为后置注入，未注入时不订阅（此时页面也发不出 todo 请求）。
     */
    private watchTodoChanges(view: vscode.WebviewView): void {
        this.stopWatchingTodoChanges()
        const routes = this.todoRoutes
        if (routes === null) {
            return
        }
        this.todoListener = routes.onDidChange(() => {
            this.post(view, { type: 'state', channel: 'todo', payload: { kind: 'changed' } })
        })
    }

    /** 释放待办变更监听 */
    private stopWatchingTodoChanges(): void {
        this.todoListener?.dispose()
        this.todoListener = null
    }

    /**
     * 组装活跃笔记快照：优先认索引库内已登记的文档，其余（含焦点不在编辑器上）一律为 null。
     * 关键约束：hasEditor 如实反映「是否存在文本编辑器」，前端据此区分「焦点不在编辑器」与
     * 「编辑器里是索引外文档（未保存的 untitled 等）」——前者不改变面板当前页，后者须判定为无归属；
     * 查索引必须用 findIndexedFile 而不是笔记视角的 listFilesByPaths——后者只认 notes/，会把作品与
     * 公众号文档一律判成无归属（仪表盘因此无法跟到账号页、工作流也切不过去归属）；
     * 批次文档（wechat/{appid}/post/…）在索引尚未收录时按路径直接放行：索引是缓存，刚建的文件或
     * 刚解除排除的目录还没进库，此时仍要能按 AppID 跟随。
     */
    private buildActiveNote(): NoteActiveState {
        // 用活跃文档事实源而不是 activeTextEditor：富文本 tab 没有 TextEditor，
        // 直读会让仪表盘在富文本下永远判成「焦点不在编辑器」，列表不跟随
        const active = getActiveDocument()
        if (active === null) {
            return { activePath: null, hasEditor: false }
        }
        const relativePath = this.indexService.toRelativePath(active.uri)
        const known = findIndexedFile(this.db, relativePath)
        if (known !== null) {
            return { activePath: known.path, hasEditor: true }
        }
        return { activePath: isWechatBatchDocPath(relativePath) ? relativePath : null, hasEditor: true }
    }

    /**
     * 组装活跃作品快照：面板打开时请求一次，命中即让仪表盘直接进入该作品的章节列表。
     * 关键约束：webview 抢焦点时 activeTextEditor 会缺位，此时回落到活动标签页的文本输入；
     * 一级目录必须是 press 且作品须在索引库内，否则一律 null，避免把面板带到不存在的详情页。
     */
    private buildActivePressProject(): PressActiveState {
        const uri = this.readActiveDocumentUri()
        if (uri === null) {
            return { activeProjectDirPath: null }
        }
        const [moduleKey, projectName] = this.indexService.toRelativePath(uri).split('/')
        if (moduleKey !== PRESS_MODULE_DIR || projectName === undefined || projectName === '') {
            return { activeProjectDirPath: null }
        }
        const dirPath = `${PRESS_MODULE_DIR}/${projectName}`
        return { activeProjectDirPath: hasProjectFiles(this.db, dirPath) ? dirPath : null }
    }

    /** 取当前文档：优先活动编辑器，焦点被 webview 抢走时回落活动标签页的文本输入 */
    private readActiveDocumentUri(): vscode.Uri | null {
        const active = getActiveDocument()
        if (active !== null) {
            return active.uri
        }
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        if (input instanceof vscode.TabInputText) {
            return input.uri
        }
        if (input instanceof vscode.TabInputTextDiff) {
            return input.modified
        }
        // 富文本自定义编辑器同样算「打开了某篇文档」
        if (input instanceof vscode.TabInputCustom) {
            return input.uri
        }
        return null
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}
