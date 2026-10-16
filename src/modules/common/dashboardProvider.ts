/**
 * 仪表盘 Webview 面板（宿主侧）：加载 React 构建产物，路由 Webview 请求到统计聚合、笔记创建/打开、置顶设置、工作流页跳转与宿主命令。
 * 协议：仅接受带 reqId 的 request 消息（shared/types/messages），响应按 reqId 匹配回传；
 * 另经 state 消息主动广播：note 通道给活跃笔记（列表回填选中态），index 通道给索引状态（列表随编辑收敛）。
 * 关键约束：请求处理为异步流程（新建笔记需落盘 + 索引 + 打开，打开与置顶须先经索引库校验路径），
 * 须 await 结果后再回包；命令入口一律经白名单校验，未登记的命令直接拒绝；
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
import type { PinStore } from '../note/pinStore'
import type { IndexService, IndexStatus } from './indexer/indexService'
import type { DashboardStats } from '../../shared/types/dashboard'
import type { HostToWebviewMessage } from '../../shared/types/messages'
import type { NoteActiveState, OpenNoteResult, PinNotesResult } from '../../shared/types/note'
import type { OpenWorkflowResult } from '../../shared/types/workflow'
import type Database from 'better-sqlite3'
import { isRequestMessage } from '../../shared/types/messages'
import { isOpenNoteRequest, isPinNotesRequest } from '../../shared/types/note'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { createAndOpenNote, openNoteByPath } from '../note/noteService'

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'zhai.dashboard'

    /** 活跃编辑器监听：面板销毁时释放，避免重开面板后监听堆积、重复广播 */
    private activeNoteListener: vscode.Disposable | null = null
    /** 索引状态监听：面板存活期间把索引变更转给 Webview，使列表跟随文件编辑收敛 */
    private indexStatusListener: vscode.Disposable | null = null

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly db: Database.Database,
        private readonly indexService: IndexService,
        private readonly pins: PinStore,
        private readonly indexStatus: vscode.Event<IndexStatus>,
    ) {}

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
            const result = await this.invoke(method, payload)
            this.post(view, { type: 'response', reqId, ok: true, payload: result })
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            logger.error(`Webview 请求处理失败：${method}`, error)
            this.post(view, { type: 'response', reqId, ok: false, error: { code: method, message: text } })
        }
    }

    private invoke(method: string, payload: unknown): Promise<unknown> {
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
