/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合、笔记创建/打开、置顶设置、
 * 工作流页跳转、写作管理（作品列表、作品详情、新建作品与章节、卷的重命名与删除、章节的删除与跨卷移动、
 * 整部作品删除）聚合与创建，以及宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应按 reqId 匹配回传；
 * 另经 state 消息主动广播：note 通道给活跃笔记（列表回填选中态），index 通道给索引状态（列表随编辑收敛）。
 * 关键约束：请求处理为异步流程（新建笔记/作品/章节、卷重命名与删除、章节删除与移动需落盘 + 索引 + 打开，
 * 打开与置顶须先经索引库校验路径），
 * 须 await 结果后再回包；命令入口一律经白名单校验，未登记的命令直接拒绝；
 * 作品协议只做入参收窄与转发，聚合/落盘由 modules/press 承担，打开路径须先按索引库回查；
 * 活跃编辑器与索引状态监听须随面板销毁释放，否则重开面板会叠加监听、重复广播。
 */
import * as vscode from 'vscode'
import {
    aggregateFileStats,
    listFilesByPaths,
    listRecentFiles,
    mergePinnedFiles,
    RECENT_LIMIT,
} from './db/statsRepository'
import { logger } from './logger'
import { WEBVIEW_ALLOWED_COMMANDS } from './webviewCommands'
import { buildWebviewHtml } from './webviewHtml'
import type { WorkflowRouter } from '../ai/workflowRouter'
import type { PinStore } from '../note/pinStore'
import type { IndexService, IndexStatus } from './indexer/indexService'
import type { DashboardStats } from '../../shared/types/dashboard'
import type { HostToWebviewMessage } from '../../shared/types/messages'
import type { NoteActiveState, OpenNoteResult, PinNotesResult } from '../../shared/types/note'
import type {
    CreatePressProjectResult,
    CreatedPressChapter,
    CreatedPressVolume,
    MovedPressChapter,
    OpenPressProjectResult,
    PressExtractCharactersResult,
    PressImportCandidate,
    PressImportProgress,
    PressImportStartResult,
    PressProjectDetail,
    PressSemanticProgress,
    PressSemanticStartResult,
    RenamedPressVolume,
} from '../../shared/types/press'
import type { OpenWorkflowResult } from '../../shared/types/workflow'
import type { ImportSemanticService } from '../press/importSemanticService'
import type Database from 'better-sqlite3'
import { isRequestMessage } from '../../shared/types/messages'
import { isOpenNoteRequest, isPinNotesRequest } from '../../shared/types/note'
import {
    isCreatePressChapterRequest,
    isCreatePressProjectRequest,
    isDeletePressChapterRequest,
    isDeletePressProjectRequest,
    isDeletePressVolumeRequest,
    isMovePressChapterRequest,
    isOpenPressChapterRequest,
    isPressDirPath,
    isPressExtractCharactersRequest,
    isPressImportStartRequest,
    isPressSemanticStartRequest,
    isRenamePressVolumeRequest,
    readPressAudience,
} from '../../shared/types/press'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { createAndOpenNote, openNoteByPath } from '../note/noteService'
import { SemanticError } from '../press/importSemanticService'
import { ImportError, PressImportService } from '../press/importService'
import {
    hasProjectFile,
    hasProjectFiles,
    listPressProjects,
    listProjectChapterPaths,
    listVolumeFilePaths,
    readProjectDetail,
} from '../press/projectRepository'
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
} from '../press/projectService'

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.dashboard'

    /** 活跃编辑器监听：面板销毁时释放，避免重开面板后监听堆积、重复广播 */
    private activeNoteListener: vscode.Disposable | null = null
    /** 索引状态监听：面板存活期间把索引变更转给 Webview，使列表跟随文件编辑收敛 */
    private indexStatusListener: vscode.Disposable | null = null
    /** 作品导入服务：持有待导入文件 token 与进行中的任务，长任务进度经 state 通道广播 */
    private readonly importService: PressImportService
    /** 语义归纳服务：AI 通道晚于仪表盘创建，故用后置注入；未注入时相关请求直接拒绝 */
    private semanticService: ImportSemanticService | null = null

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

    /** 注入语义归纳服务：由扩展入口在 AI 通道就绪后调用 */
    public attachSemanticService(service: ImportSemanticService): void {
        this.semanticService = service
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
        }
        void this.renderHtml(webviewView)
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => void this.handleMessage(webviewView, message),
            this,
        )
        this.watchActiveNote(webviewView)
        this.watchIndexStatus(webviewView)
        webviewView.onDidDispose(() => {
            this.stopWatchingActiveNote()
            this.stopWatchingIndexStatus()
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
            // 导入与归纳类错误带业务原因码，前端据此分发提示文案；其余仍以协议方法名兜底
            const code = error instanceof ImportError || error instanceof SemanticError ? error.code : method
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
            case 'workflow/open': {
                return this.openWorkflow(payload)
            }
            case 'press/projects': {
                return Promise.resolve(listPressProjects(this.db))
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
            case 'press/semantic/start': {
                return this.startPressSemantic(view, payload)
            }
            case 'press/semantic/cancel': {
                return Promise.resolve(this.cancelPressSemantic(payload))
            }
            case 'press/extract/characters': {
                return this.extractPressCharacters(view, payload)
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
            default:
                throw new Error(`未知的协议方法：${method}`)
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
     * 作品下已无卷时无需补建，下次新增章节会回落到默认卷1。
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
     * 启动语义归纳：立即回传 jobId，进度与终态经 press-semantic 通道广播。
     * 关键约束：归纳要遍历全部章节并逐批调用模型，属长任务，不能占用请求超时；
     * 服务未注入（AI 通道未就绪）时直接拒绝，避免前端拿到永远不会有下文的 jobId。
     */
    private startPressSemantic(view: vscode.WebviewView, payload: unknown): Promise<PressSemanticStartResult> {
        if (!isPressSemanticStartRequest(payload)) {
            throw new Error('press/semantic/start 参数非法：dirPath 须为 press/ 下的相对路径')
        }
        const service = this.semanticService
        if (service === null) {
            throw new Error('AI 通道尚未就绪，无法执行语义归纳')
        }
        const jobId = `semantic-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
        const emit = (progress: PressSemanticProgress): void => {
            this.post(view, { type: 'state', channel: 'press-semantic', payload: progress })
        }
        void service
            .start(jobId, payload.dirPath, emit)
            .then((outcome) => {
                emit({
                    jobId,
                    stage: 'summary',
                    status: outcome.status,
                    done: outcome.done,
                    total: outcome.total,
                    generated: outcome.generated,
                    dirPath: outcome.dirPath,
                    ...(outcome.code === undefined ? {} : { code: outcome.code }),
                    message: outcome.message,
                })
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                logger.error(`语义归纳异常：${jobId}`, error)
                emit({
                    jobId,
                    stage: 'summary',
                    status: 'failed',
                    done: 0,
                    total: 0,
                    generated: 0,
                    dirPath: payload.dirPath,
                    code: error instanceof SemanticError ? error.code : 'internal',
                    message,
                })
            })
        return Promise.resolve({ jobId })
    }

    /** 取消语义归纳：按 jobId 匹配，避免旧任务的取消请求误停当前任务 */
    private cancelPressSemantic(payload: unknown): { cancelled: boolean } {
        const jobId =
            typeof payload === 'object' && payload !== null ? (payload as { jobId?: unknown }).jobId : undefined
        if (typeof jobId !== 'string' || jobId.length === 0) {
            throw new Error('press/semantic/cancel 参数非法：jobId 须为非空字符串')
        }
        const service = this.semanticService
        if (service === null) {
            return { cancelled: false }
        }
        return service.cancel(jobId)
    }

    /**
     * 从导入素材提取人物卡：只跑角色卡阶段，进度经 press-semantic 通道广播，终态随响应回传草案。
     * 关键约束：作品目录先按索引库回查，不采信前端路径；提取是逐批调用模型的长任务，
     * 响应到终态才返回，前端须自行放宽请求超时。
     */
    private async extractPressCharacters(
        view: vscode.WebviewView,
        payload: unknown,
    ): Promise<PressExtractCharactersResult> {
        if (!isPressExtractCharactersRequest(payload)) {
            throw new Error('press/extract/characters 参数非法：dirPath 须为非空字符串')
        }
        const service = this.semanticService
        if (service === null) {
            throw new Error('AI 通道尚未就绪，无法提取人物卡')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法提取人物卡：${payload.dirPath}`)
        }
        const jobId = `extract-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
        const emit = (progress: PressSemanticProgress): void => {
            this.post(view, { type: 'state', channel: 'press-semantic', payload: progress })
        }
        return service.extractCharacters(jobId, payload.dirPath, emit)
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
     * 删除作品：整部作品移入回收站并清理索引，确认交互由前端承担。
     * 关键约束：先按索引库回查目录下是否登记过文档，不采信前端路径；删除成功后清空工作台的当前作品，
     * 避免侧栏写作页停留在已删除的作品上。
     */
    private async deletePressProject(payload: unknown): Promise<{ deleted: boolean }> {
        if (!isDeletePressProjectRequest(payload)) {
            throw new Error('press/deleteProject 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法删除：${payload.dirPath}`)
        }
        await deleteProject(this.indexService, { dirPath: payload.dirPath })
        this.workflowRouter.clearProject()
        logger.info(`作品删除完成：${payload.dirPath}`)
        return { deleted: true }
    }

    /**
     * 监听编辑器焦点变化并广播活跃笔记：列表选中态以编辑器真实焦点为准，而非仅记录最后一次点击，
     * 使用户关闭当前笔记后能跟随 VSCode 的焦点回退自动切回上一篇。
     * 关键约束：注册前先释放旧监听，面板销毁时一并清理，避免 WebviewView 重建后重复广播。
     */
    private watchActiveNote(view: vscode.WebviewView): void {
        this.stopWatchingActiveNote()
        this.activeNoteListener = vscode.window.onDidChangeActiveTextEditor(() => {
            this.post(view, { type: 'state', channel: 'note', payload: this.buildActiveNote() })
        })
    }

    /** 释放活跃编辑器监听 */
    private stopWatchingActiveNote(): void {
        this.activeNoteListener?.dispose()
        this.activeNoteListener = null
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
     * 组装活跃笔记快照：仅认索引库内已登记的笔记，其余（含焦点不在编辑器上）一律为 null，
     * 使列表高亮永远收敛到真实存在的条目。
     */
    private buildActiveNote(): NoteActiveState {
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            return { activePath: null }
        }
        const relativePath = this.indexService.toRelativePath(editor.document.uri)
        const [known] = listFilesByPaths(this.db, [relativePath])
        return { activePath: known?.path ?? null }
    }

    private post(view: vscode.WebviewView, message: HostToWebviewMessage): void {
        void view.webview.postMessage(message)
    }
}
