/**
 * 写作管理协议路由：把 pressAi/* 消息分发到人物外貌与角色设定图两个服务，
 * 并承接工作台的作品读取、打开与人物卡提取（press/workspace、press/open、press/extract/characters），
 * 以及作品快照的列举、手动留版、恢复与删除（press/snapshot/*），入参收窄由本层与 shared 类型完成。
 * 复用约定：由 AiChatViewProvider 按前缀统一委托，本类只做方法到服务的映射；
 * 作品列表取索引库聚合结果，文档原文由 projectWorkspace 读取，打开动作与仪表盘 press/open 同口径，
 * 人物卡提取复用语义归纳服务，与仪表盘共用同一实例（单任务锁与配额口径一致）。
 * 关键约束：pressAi/* 与仪表盘的作品写操作（press/create、press/delete* 等）刻意分开，工作台只读作品、不改作品；
 * 前端传入的 dirPath 不可信，打开、提取与快照操作前都必须按索引库回查，读取前由 projectWorkspace 做片段与层级校验；
 * 快照写入挂在回写钩子上而不是重复读盘，回写失败时不会凭空产生一版历史。
 */
import { hasProjectFiles, listPressProjects } from './projectRepository'
import { openProjectByDir } from './projectService'
import { readProjectWorkspace } from './projectWorkspace'
import { applyProjectWorkspace } from './workspaceWriter'
import type { ImportSemanticService } from './importSemanticService'
import type { PressAiService } from './pressAiService'
import type { PressSnapshotService } from './snapshot/snapshotService'
import type {
    ChapterSnapshotCaptureResult,
    ChapterSnapshotDeleteResult,
    ChapterSnapshotListResult,
    ChapterSnapshotRestoreResult,
    ChapterSnapshotVersionsResult,
    OpenPressProjectResult,
    PressApplyResult,
    PressExtractCharactersResult,
    PressExtractOutlineResult,
    PressExtractSettingResult,
    PressSemanticProgress,
    PressSnapshotCreateResult,
    PressSnapshotDeleteResult,
    PressSnapshotListResult,
    PressSnapshotRestoreResult,
    PressWorkspaceResult,
} from '../../shared/types/press'
import type { WorkflowRouter } from '../ai/workflowRouter'
import type { PressCoverService } from '../imagegen/coverService'
import type { ImageGenerateService } from '../imagegen/imageGenerateService'
import type { ImageLibraryService } from '../imagegen/imageLibraryService'
import type { ImageSettingsService } from '../imagegen/imageSettingsService'
import type { PortraitService } from '../imagegen/portraitService'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import {
    isChapterSnapshotCaptureRequest,
    isChapterSnapshotDeleteRequest,
    isChapterSnapshotListRequest,
    isChapterSnapshotRestoreRequest,
    isChapterSnapshotVersionsRequest,
    isPressApplyRequest,
    isPressDirPath,
    isPressExtractCharactersRequest,
    isPressExtractOutlineRequest,
    isPressExtractSettingRequest,
    isPressSnapshotCreateRequest,
    isPressSnapshotDeleteRequest,
    isPressSnapshotListRequest,
    isPressSnapshotRestoreRequest,
    isPressWorkspaceRequest,
} from '../../shared/types/press'
import { logger } from '../common/logger'

export class PressRoutes {
    public constructor(
        private readonly service: PressAiService,
        private readonly portraits: PortraitService,
        private readonly covers: PressCoverService,
        private readonly db: Database.Database,
        private readonly workflowRouter: WorkflowRouter,
        private readonly semantic: ImportSemanticService,
        private readonly snapshot: PressSnapshotService,
        private readonly imageLibrary: ImageLibraryService,
        private readonly imageGenerate: ImageGenerateService,
        private readonly imageSettings: ImageSettingsService,
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
            case 'pressAi/listPortraitGallery':
                return this.portraits.listGallery(payload, toWebviewUri)
            case 'pressAi/copyPortrait':
                return this.portraits.copyToClipboard(payload)
            case 'pressAi/insertPortrait':
                return this.portraits.insertIntoEditor(payload)
            case 'pressAi/deletePortrait':
                return this.portraits.remove(payload)
            case 'pressAi/aiPortrait/abort':
                return this.portraits.abort()
            case 'pressAi/generateCover':
                return this.covers.generate(payload, toWebviewUri)
            case 'pressAi/listCover':
                return this.covers.list(payload, toWebviewUri)
            case 'pressAi/selectCover':
                return this.covers.select(payload)
            case 'pressAi/saveCover':
                return this.covers.save(payload, toWebviewUri)
            case 'pressAi/deleteCover':
                return this.covers.remove(payload)
            case 'pressAi/listImageLibrary':
                return this.imageLibrary.list(payload, toWebviewUri)
            case 'pressAi/generateImage':
                return this.imageGenerate.generate(payload, toWebviewUri)
            case 'pressAi/generateImage/abort':
                return this.imageGenerate.abort()
            case 'pressAi/enhanceImagePrompt':
                return this.imageGenerate.enhance(payload)
            case 'pressAi/getImageSettings':
                return this.imageSettings.get(payload)
            case 'pressAi/saveImageSettings':
                return this.imageSettings.save(payload)
            case 'pressAi/setImageCover':
                return this.imageLibrary.setCover(payload)
            case 'pressAi/deleteImage':
                return this.imageLibrary.remove(payload)
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
            case 'press/snapshot/list':
                return this.listSnapshots(payload)
            case 'press/snapshot/create':
                return this.createSnapshot(payload)
            case 'press/snapshot/restore':
                return this.restoreSnapshot(payload)
            case 'press/snapshot/delete':
                return this.deleteSnapshot(payload)
            case 'press/snapshot/chapter/list':
                return this.listChapterSnapshots(payload)
            case 'press/snapshot/chapter/versions':
                return this.listChapterSnapshotVersions(payload)
            case 'press/snapshot/chapter/capture':
                return this.captureChapterSnapshot(payload)
            case 'press/snapshot/chapter/restore':
                return this.restoreChapterSnapshot(payload)
            case 'press/snapshot/chapter/delete':
                return this.deleteChapterSnapshot(payload)
            default:
                throw new Error(`未知的写作管理协议方法：${method}`)
        }
    }

    /**
     * 回写作品文档：把草稿段落合并进 README、设定、角色设定与大纲，只写请求里带上的那几份。
     * 删除名单里的角色同时清理其设定图；图片清理失败只记日志，不让已完成的文档回写回滚。
     * 安全约束：入参逐字段校验类型与规模，路径由回写模块统一校验，不采信前端拼出的绝对路径。
     */
    private async applyWorkspace(payload: unknown): Promise<PressApplyResult> {
        if (!isPressApplyRequest(payload)) {
            throw new Error('press/apply 参数非法：作品目录或段落内容不完整')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法回写：${payload.dirPath}`)
        }
        const result = await applyProjectWorkspace(payload, {
            onWritten: (outcome) => this.snapshot.recordWorkspaceWrite(outcome.dirPath, outcome.files, outcome.trigger),
        })
        for (const characterId of payload.deletedCharacterIds ?? []) {
            try {
                await this.portraits.removeByCharacterId(payload.dirPath, characterId)
            } catch (error) {
                logger.error(`角色设定图清理失败：${payload.dirPath}/${characterId}`, error)
            }
        }
        return result
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

    /**
     * 列出作品快照时间线：按创建时间倒序，只含元信息。
     * 安全约束：作品目录先按索引库回查，不采信前端路径。
     */
    private async listSnapshots(payload: unknown): Promise<PressSnapshotListResult> {
        if (!isPressSnapshotListRequest(payload)) {
            throw new Error('press/snapshot/list 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法列出快照：${payload.dirPath}`)
        }
        return { snapshots: await this.snapshot.list(payload.dirPath) }
    }

    /**
     * 手动留一版：不受自动快照间隔限制，备注原样落 meta。
     * 安全约束：作品目录先按索引库回查。
     */
    private async createSnapshot(payload: unknown): Promise<PressSnapshotCreateResult> {
        if (!isPressSnapshotCreateRequest(payload)) {
            throw new Error('press/snapshot/create 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法创建快照：${payload.dirPath}`)
        }
        return { snapshot: await this.snapshot.create(payload.dirPath, payload.label) }
    }

    /**
     * 恢复指定版本：files 缺省为整版恢复，恢复前由服务自动留底。
     * 安全约束：快照标识由类型守卫校验为固定格式，路径一律由宿主从存储根拼装。
     */
    private async restoreSnapshot(payload: unknown): Promise<PressSnapshotRestoreResult> {
        if (!isPressSnapshotRestoreRequest(payload)) {
            throw new Error('press/snapshot/restore 参数非法：作品目录或快照标识不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法恢复快照：${payload.dirPath}`)
        }
        const restored = await this.snapshot.restore(payload.dirPath, payload.snapshotId, payload.files)
        return { restored }
    }

    /** 删除一版快照：只删该目录，索引与作品文档不受影响 */
    private async deleteSnapshot(payload: unknown): Promise<PressSnapshotDeleteResult> {
        if (!isPressSnapshotDeleteRequest(payload)) {
            throw new Error('press/snapshot/delete 参数非法：作品目录或快照标识不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法删除快照：${payload.dirPath}`)
        }
        return { deleted: await this.snapshot.remove(payload.dirPath, payload.snapshotId) }
    }

    /** 列出有快照的章节：只返回元信息，正文按需读取 */
    private async listChapterSnapshots(payload: unknown): Promise<ChapterSnapshotListResult> {
        if (!isChapterSnapshotListRequest(payload)) {
            throw new Error('press/snapshot/chapter/list 参数非法：dirPath 须为非空字符串')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法列出章节快照：${payload.dirPath}`)
        }
        return { chapters: await this.snapshot.listChapters(payload.dirPath) }
    }

    /** 列出某章的版本时间线：章节路径的合法性由服务层的片段校验兜底 */
    private async listChapterSnapshotVersions(payload: unknown): Promise<ChapterSnapshotVersionsResult> {
        if (!isChapterSnapshotVersionsRequest(payload)) {
            throw new Error('press/snapshot/chapter/versions 参数非法：作品目录或章节路径不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法列出章节快照：${payload.dirPath}`)
        }
        return { versions: await this.snapshot.listChapterVersions(payload.dirPath, payload.chapterPath) }
    }

    /** 手动给某章留一版：正文取磁盘当前内容，备注可选 */
    private async captureChapterSnapshot(payload: unknown): Promise<ChapterSnapshotCaptureResult> {
        if (!isChapterSnapshotCaptureRequest(payload)) {
            throw new Error('press/snapshot/chapter/capture 参数非法：作品目录或章节路径不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法创建章节快照：${payload.dirPath}`)
        }
        const snapshot = await this.snapshot.captureChapter(payload.dirPath, payload.chapterPath, payload.label)
        return { snapshot }
    }

    /** 恢复单章：编辑器内有未保存修改时由服务层拒绝，避免写盘被编辑器回写覆盖 */
    private async restoreChapterSnapshot(payload: unknown): Promise<ChapterSnapshotRestoreResult> {
        if (!isChapterSnapshotRestoreRequest(payload)) {
            throw new Error('press/snapshot/chapter/restore 参数非法：作品目录、章节路径或快照标识不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法恢复章节快照：${payload.dirPath}`)
        }
        return {
            restored: await this.snapshot.restoreChapter(payload.dirPath, payload.chapterPath, payload.snapshotId),
        }
    }

    /** 删除章节某一版：只删该版本文件，作品文档与其它版本不受影响 */
    private async deleteChapterSnapshot(payload: unknown): Promise<ChapterSnapshotDeleteResult> {
        if (!isChapterSnapshotDeleteRequest(payload)) {
            throw new Error('press/snapshot/chapter/delete 参数非法：作品目录、章节路径或快照标识不合法')
        }
        if (!hasProjectFiles(this.db, payload.dirPath)) {
            throw new Error(`作品不在索引中，无法删除章节快照：${payload.dirPath}`)
        }
        return {
            deleted: await this.snapshot.removeChapterVersion(payload.dirPath, payload.chapterPath, payload.snapshotId),
        }
    }
}
