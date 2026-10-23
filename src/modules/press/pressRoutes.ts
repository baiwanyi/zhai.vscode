/**
 * 写作管理协议路由：把 pressAi/* 消息分发到人物外貌与角色设定图两个服务，
 * 并承接工作台的作品读取与打开（press/workspace、press/open），入参收窄由本层与 shared 类型完成。
 * 复用约定：由 AiChatViewProvider 按前缀统一委托，本类只做方法到服务的映射；
 * 作品列表取索引库聚合结果，文档原文由 projectWorkspace 读取，打开动作与仪表盘 press/open 同口径。
 * 关键约束：pressAi/* 与仪表盘的作品写操作（press/create、press/delete* 等）刻意分开，工作台只读作品、不改作品；
 * 前端传入的 dirPath 不可信，打开前必须按索引库回查，读取前由 projectWorkspace 做片段与层级校验。
 */
import { hasProjectFiles, listPressProjects } from './projectRepository'
import { openProjectByDir } from './projectService'
import { readProjectWorkspace } from './projectWorkspace'
import type { PortraitService } from './portraitService'
import type { PressAiService } from './pressAiService'
import type { OpenPressProjectResult, PressWorkspaceResult } from '../../shared/types/press'
import type { WorkflowRouter } from '../ai/workflowRouter'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import { isPressDirPath, isPressWorkspaceRequest } from '../../shared/types/press'

export class PressRoutes {
    public constructor(
        private readonly service: PressAiService,
        private readonly portraits: PortraitService,
        private readonly db: Database.Database,
        private readonly workflowRouter: WorkflowRouter,
    ) {}

    /**
     * 处理写作管理协议方法
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async handle(method: string, payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<unknown> {
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
            default:
                throw new Error(`未知的写作管理协议方法：${method}`)
        }
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
