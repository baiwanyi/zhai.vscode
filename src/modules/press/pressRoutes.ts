/**
 * 写作管理协议路由：把 pressAi/* 消息分发到人物外貌与角色设定图两个服务，
 * 并承接工作台的作品读取、打开与人物卡提取（press/workspace、press/open、press/extract/characters），
 * 入参收窄由本层与 shared 类型完成。
 * 复用约定：由 AiChatViewProvider 按前缀统一委托，本类只做方法到服务的映射；
 * 作品列表取索引库聚合结果，文档原文由 projectWorkspace 读取，打开动作与仪表盘 press/open 同口径，
 * 人物卡提取复用语义归纳服务，与仪表盘共用同一实例（单任务锁与配额口径一致）。
 * 关键约束：pressAi/* 与仪表盘的作品写操作（press/create、press/delete* 等）刻意分开，工作台只读作品、不改作品；
 * 前端传入的 dirPath 不可信，打开与提取前必须按索引库回查，读取前由 projectWorkspace 做片段与层级校验。
 */
import { hasProjectFiles, listPressProjects } from './projectRepository'
import { openProjectByDir } from './projectService'
import { readProjectWorkspace } from './projectWorkspace'
import { applyProjectWorkspace } from './workspaceWriter'
import type { ImportSemanticService } from './importSemanticService'
import type { PortraitService } from './portraitService'
import type { PressAiService } from './pressAiService'
import type {
    OpenPressProjectResult,
    PressApplyResult,
    PressExtractCharactersResult,
    PressExtractOutlineResult,
    PressExtractSettingResult,
    PressSemanticProgress,
    PressSemanticRunResult,
    PressWorkspaceResult,
} from '../../shared/types/press'
import type { WorkflowRouter } from '../ai/workflowRouter'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import {
    isPressApplyRequest,
    isPressDirPath,
    isPressExtractCharactersRequest,
    isPressExtractOutlineRequest,
    isPressExtractSettingRequest,
    isPressSemanticCancelRequest,
    isPressSemanticRunRequest,
    isPressWorkspaceRequest,
} from '../../shared/types/press'
import { logger } from '../common/logger'

export class PressRoutes {
    public constructor(
        private readonly service: PressAiService,
        private readonly portraits: PortraitService,
        private readonly db: Database.Database,
        private readonly workflowRouter: WorkflowRouter,
        private readonly semantic: ImportSemanticService,
    ) {}

    /**
     * 处理写作管理协议方法
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     * @param postProgress 长任务的进度广播：由调用方决定推给哪个面板
     */
    public async handle(
        method: string,
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
        postProgress: (progress: PressSemanticProgress) => void,
    ): Promise<unknown> {
        switch (method) {
            case 'pressAi/aiAppearance':
                return this.service.generateAppearance(payload)
            case 'pressAi/aiAppearance/abort':
                return this.service.abortAppearance()
            case 'pressAi/generatePortrait':
                return this.portraits.generate(payload, toWebviewUri)
            case 'pressAi/listPortraits':
                return this.portraits.list(payload, toWebviewUri)
            case 'pressAi/copyPortrait':
                return this.portraits.copyToClipboard(payload)
            case 'pressAi/insertPortrait':
                return this.portraits.insertIntoEditor(payload)
            case 'pressAi/deletePortrait':
                return this.portraits.remove(payload)
            case 'pressAi/aiPortrait/abort':
                return this.portraits.abort()
            case 'press/workspace':
                return this.readWorkspace(payload)
            case 'press/open':
                return this.openProject(payload)
            case 'press/extract/characters':
                return this.extractCharacters(payload, postProgress)
            case 'press/extract/outline':
                return this.extractOutline(payload)
            case 'press/extract/setting':
                return this.extractSetting(payload)
            case 'press/apply':
                return this.applyWorkspace(payload)
            case 'press/semantic/run':
                return this.runSemantic(payload, postProgress)
            case 'press/semantic/cancel':
                return this.cancelSemantic(payload)
            default:
                throw new Error(`未知的写作管理协议方法：${method}`)
        }
    }

    /**
     * 启动阶段性 AI 归纳：立即返回 jobId，进度经 press-semantic 通道推给当前面板。
     * 关键约束：任务本身不等待（长任务），但前置检查必须等待，
     * 这样「AI 未就绪」「已有任务在跑」能同步报给前端，而不是等到超时。
     */
    private async runSemantic(
        payload: unknown,
        postProgress: (progress: PressSemanticProgress) => void,
    ): Promise<PressSemanticRunResult> {
        if (!isPressSemanticRunRequest(payload)) {
            throw new Error('press/semantic/run 参数非法：dirPath 或 stages 不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法归纳：${payload.dirPath}`)
        }
        await this.semantic.assertReady()
        const jobId = `workflow-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
        void this.semantic.start(jobId, payload.dirPath, postProgress, payload.stages).catch((error: unknown) => {
            logger.error(`工作台归纳失败：${payload.dirPath}`, error)
            postProgress({
                jobId,
                stage: payload.stages?.[0] ?? 'summary',
                status: 'failed',
                done: 0,
                total: 0,
                generated: 0,
                dirPath: payload.dirPath,
                message: error instanceof Error ? error.message : String(error),
            })
        })
        return { jobId }
    }

    /** 取消归纳：交给语义归纳服务在批次边界生效 */
    private cancelSemantic(payload: unknown): Promise<{ cancelled: boolean }> {
        if (!isPressSemanticCancelRequest(payload)) {
            throw new Error('press/semantic/cancel 参数非法：jobId 须为非空字符串')
        }
        return Promise.resolve(this.semantic.cancel(payload.jobId))
    }

    /**
     * 回写作品文档：把草稿段落合并进 README、设定、角色设定与大纲。
     * 安全约束：入参逐字段校验类型与规模，路径由回写模块统一校验，不采信前端拼出的绝对路径。
     */
    private async applyWorkspace(payload: unknown): Promise<PressApplyResult> {
        if (!isPressApplyRequest(payload)) {
            throw new Error('press/apply 参数非法：作品目录或段落内容不完整')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法回写：${payload.dirPath}`)
        }
        return applyProjectWorkspace(payload)
    }

    /**
     * 提取设定与金手指线索：走语义归纳的设定阶段，读金手指候选章的首尾摘录与摘要。
     * 安全约束：作品目录先按索引库回查，不采信前端路径；配额与单任务锁由语义归纳服务统一把关。
     */
    private async extractSetting(payload: unknown): Promise<PressExtractSettingResult> {
        if (!isPressExtractSettingRequest(payload)) {
            throw new Error('press/extract/setting 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法提取设定：${payload.dirPath}`)
        }
        return this.semantic.extractSetting(payload.dirPath)
    }

    /**
     * 用素材重建大纲树：卷与章取自章节清单，梗概与钩子取自摘要，卷目标与冲突取自卷纲产物。
     * 安全约束：作品目录先按索引库回查，不采信前端路径；本方法不调用模型，素材缺失时由服务补跑本地抽取。
     */
    private async extractOutline(payload: unknown): Promise<PressExtractOutlineResult> {
        if (!isPressExtractOutlineRequest(payload)) {
            throw new Error('press/extract/outline 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法提取大纲：${payload.dirPath}`)
        }
        return this.semantic.extractOutline(payload.dirPath)
    }

    /**
     * 从导入素材提取人物卡：只跑角色卡阶段，进度经 press-semantic 通道回传，终态随响应返回草案。
     * 安全约束：作品目录先按索引库回查，不采信前端路径；配额与单任务锁由语义归纳服务统一把关。
     */
    private async extractCharacters(
        payload: unknown,
        postProgress: (progress: PressSemanticProgress) => void,
    ): Promise<PressExtractCharactersResult> {
        if (!isPressExtractCharactersRequest(payload)) {
            throw new Error('press/extract/characters 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法提取人物卡：${payload.dirPath}`)
        }
        const jobId = `extract-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
        return this.semantic.extractCharacters(jobId, payload.dirPath, postProgress)
    }

    /**
     * 读取工作台文档：dirPath 缺省时只返回作品列表，供未选择作品的初始页展示入口。
     * 安全约束：文档读取前由 projectWorkspace 校验 dirPath 为 press/{作品名} 两段，列表只取索引库聚合结果。
     */
    private async readWorkspace(payload: unknown): Promise<PressWorkspaceResult> {
        if (!isPressWorkspaceRequest(payload)) {
            throw new Error('press/workspace 参数非法：dirPath 须为非空字符串')
        }
        const projects = listPressProjects(this.db)
        const dirPath = payload.dirPath
        if (dirPath === undefined) {
            return { project: null, projects }
        }
        const project = await readProjectWorkspace(dirPath)
        const { readme, setting, characters, outline } = project.files
        const isEmpty = readme === '' && setting === '' && characters === '' && outline === ''
        // 目录已被删除或从未写过文档：按「未打开作品」处理，前端回到初始页而不是展示空表单
        return { project: isEmpty ? null : project, projects }
    }

    /**
     * 打开作品：先按索引库回查该目录下是否登记过文档，再交由编辑器展示 README，并同步工作台的作品选定。
     * 安全约束：不直接采信前端传入的路径形态，未登记的作品一律拒绝，与仪表盘 press/open 同口径。
     */
    private async openProject(payload: unknown): Promise<OpenPressProjectResult> {
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
}
