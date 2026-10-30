/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合、笔记创建/打开、置顶设置、
 * 工作流页跳转、待办清单读写、写作管理（作品列表、作品详情、新建作品与章节、卷的重命名与删除、
 * 章节的删除与跨卷移动、整部作品删除）聚合与创建、公众号账号的列表与增删改鉴权，以及宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应按 reqId 匹配回传；
 * 另经 state 消息主动广播：note 通道给活跃笔记（列表回填选中态），index 通道给索引状态（列表随编辑收敛），
 * todo 通道给待办清单的外部改动（卡片收到即重读）；
 * press/active 请求返回当前文档所属的作品目录，供面板打开时一次性跟随到该作品的章节列表。
 * 关键约束：请求处理为异步流程（新建笔记/作品/章节、卷重命名与删除、章节删除与移动需落盘 + 索引 + 打开，
 * 打开与置顶须先经索引库校验路径），
 * 须 await 结果后再回包；命令入口一律经白名单校验，未登记的命令直接拒绝；
 * 作品协议只做入参收窄与转发，聚合/落盘由 modules/press 承担，打开路径须先按索引库回查；
 * 活跃编辑器与索引状态监听须随面板销毁释放，否则重开面板会叠加监听、重复广播。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { WorkflowRouter } from '@modules/ai/workflowRouter'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import type { PressCoverStore } from '@modules/media/pressCoverStore'
import { createAndOpenNote, openNoteByPath } from '@modules/note/noteService'
import type { PinStore } from '@modules/note/pinStore'
import { mergeChapterSummaries } from '@modules/press/chapterSummaryMerge'
import { analyzeProject } from '@modules/press/importAnalysis'
import { ImportError, PressImportService } from '@modules/press/importService'
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
import type { TodoRoutes } from '@modules/todo/todoRoutes'
import type { WechatRoutes } from '@modules/wechat/wechatRoutes'
import type { DashboardStats } from '@shared/types/dashboard'
import type { HostToWebviewMessage } from '@shared/types/messages'
import { isRequestMessage } from '@shared/types/messages'
import type { NoteActiveState, OpenNoteResult, PinNotesResult } from '@shared/types/note'
import { isOpenNoteRequest, isPinNotesRequest } from '@shared/types/note'
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
import type { WechatCoverPreviewResult } from '@shared/types/wechat'
import { isWechatCoverPreviewRequest } from '@shared/types/wechat'
import type { OpenWorkflowResult } from '@shared/types/workflow'
import { isOpenWorkflowRequest } from '@shared/types/workflow'
import { resolvePromptRoot, resolveStorageRoot } from './config'
import {
    aggregateFileStats,
    listFilesByPaths,
    listRecentFiles,
    mergePinnedFiles,
    RECENT_LIMIT,
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
    /** 待办目录变更监听：面板存活期间把外部改动转给 Webview，销毁时释放 */
    private todoListener: vscode.Disposable | null = null

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly db: Database.Database,
        private readonly indexService: IndexService,
        private readonly pins: PinStore,
        private readonly indexStatus: vscode.Event<IndexStatus>,
        private readonly workflowRouter: WorkflowRouter,
    ) {
        this.importService = new PressImportService(indexService)
    }

    /** 注入封面选择仓储：由扩展入口在 press.db 打开后调用，作品列表据此显示封面 */
    public attachPressCoverStore(store: PressCoverStore): void {
        this.coverStore = store
    }

    /** 注入待办路由：由扩展入口在待办服务装配后调用，待办卡片据此读写 todo/ 下的清单 */
    public attachTodoRoutes(routes: TodoRoutes): void {
        this.todoRoutes = routes
    }

    /** 注入公众号路由：由扩展入口在 wechat.db 打开后调用，公众号列表页据此读写账号 */
    public attachWechatRoutes(routes: WechatRoutes): void {
        this.wechatRoutes = routes
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
        webviewView.onDidDispose(() => {
            this.stopWatchingActiveDocument()
            this.stopWatchingIndexStatus()
            this.stopWatchingTodoChanges()
        }, this)
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

    private invoke(view: vscode.WebviewView, method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'dashboard/stats': {
                return Promise.resolve(this.buildStats())
            }
            case 'note/create': {
                return createAndOpenNote(this.indexService)
            }
            case 'note/pin': {
                return this.setPinned(payload)
            }
            case 'note/open': {
                return this.openNote(payload)
            }
            case 'note/active': {
                return Promise.resolve(this.buildActiveNote())
            }
            case 'press/active': {
                return Promise.resolve(this.buildActivePressProject())
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
            case 'index/rebuild': {
                void this.indexService.fullRebuild()
                return Promise.resolve({ started: true })
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
                    return routes.handle(method, payload, (progress) => {
                        this.post(view, { type: 'state', channel: 'wechat', payload: progress })
                    })
                }
                throw new Error(`未知的协议方法：${method}`)
            }
        }
    }

    /** 组装统计快照：文件级聚合与最近更新来自索引库，置顶顺序来自宿主偏好，构建状态来自索引服务 */
    private buildStats(): DashboardStats {
        const status = this.indexService.getStatus()
        const pinnedPaths = this.pins.list()
        // 多取置顶项数量：置顶项可能同时命中最近更新，多取的额度用于抵消这部分重复占位
        const recent = listRecentFiles(this.db, RECENT_LIMIT + pinnedPaths.length)
        return {
            ...aggregateFileStats(this.db),
            recentFiles: mergePinnedFiles(listFilesByPaths(this.db, pinnedPaths), recent, RECENT_LIMIT),
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
        return { opened: true }
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
     * 关键约束：先回查作品存在，避免向不存在的作品目录写入文件；返回落点卷名供前端提示。
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
        await openChapterByPath(created.path)
        logger.info(`章节创建完成并打开：${created.path}`)
        return { path: created.path, title: created.title, volume: created.volume }
    }

    /**
     * 新建卷：卷序号与首章由 press 服务生成，创建后打开首章供用户续写。
     * 关键约束：建卷必然带首章——索引库只记录文档，空卷不会出现在详情页；
     * 返回卷目录与首章信息，供前端展开该卷并提示落点。
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
        await openChapterByPath(created.chapterPath)
        logger.info(`卷创建完成并打开首章：${created.chapterPath}`)
        return {
            volumeDir: created.volumeDir,
            volumeName: created.volumeName,
            chapterPath: created.chapterPath,
            chapterTitle: created.chapterTitle,
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
     * 回填章节摘要：把 Materials/summaries.tsv 的摘要按 index.tsv 的路径写回章节 Frontmatter 的 summary。
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
        this.workflowRouter.clearProject()
        logger.info(`作品删除完成：${payload.dirPath}`)
        return { deleted: true, permanent: outcome === 'permanent' }
    }

    /**
     * 监听编辑器焦点变化并广播当前文档：note 通道供笔记列表回填选中态，press 通道供仪表盘同步到当前作品。
     * 列表选中态以编辑器真实焦点为准，而非仅记录最后一次点击，使用户关闭当前笔记后能跟随 VSCode 的焦点回退自动切回上一篇。
     * 关键约束：注册前先释放旧监听，面板销毁时一并清理，避免 WebviewView 重建后重复广播；
     * 两条广播共用同一次焦点事件，press 侧在 webview 抢焦点时按活动标签页回落，不依赖 activeTextEditor 是否存在。
     */
    private watchActiveDocument(view: vscode.WebviewView): void {
        this.stopWatchingActiveDocument()
        this.activeDocumentListener = vscode.window.onDidChangeActiveTextEditor(() => {
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
     * 组装活跃笔记快照：仅认索引库内已登记的笔记，其余（含焦点不在编辑器上）一律为 null，
     * 使列表高亮永远收敛到真实存在的条目。
     * 关键约束：hasEditor 如实反映「是否存在文本编辑器」，前端据此区分「焦点不在编辑器」与
     * 「编辑器里是索引外文档（未保存的 untitled 等）」——前者不改变面板当前页，后者须判定为无归属。
     */
    private buildActiveNote(): NoteActiveState {
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            return { activePath: null, hasEditor: false }
        }
        const relativePath = this.indexService.toRelativePath(editor.document.uri)
        const [known] = listFilesByPaths(this.db, [relativePath])
        return { activePath: known?.path ?? null, hasEditor: true }
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
        const editor = vscode.window.activeTextEditor
        if (editor !== undefined) {
            return editor.document.uri
        }
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        if (input instanceof vscode.TabInputText) {
            return input.uri
        }
        if (input instanceof vscode.TabInputTextDiff) {
            return input.modified
        }
        return null
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}
