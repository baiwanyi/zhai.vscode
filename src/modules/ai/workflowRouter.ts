/**
 * 工作流路由事实服务：汇聚「活跃编辑器场景」与「用户选定的模块」，供工作流面板按模块渲染对应页面。
 * 复用 IndexService.toRelativePath 与索引库回查判定文档归属，与仪表盘活跃笔记回填同口径。
 * 关键约束：编辑器监听随扩展停用释放；场景变化经去抖后再广播，避免编辑器焦点抖动导致面板反复换页；
 * 模块选定为持久状态（跨面板重建保留），仅在用户改选或清除时变化，未选定时由面板展示初始页。
 */
import * as vscode from 'vscode'
import type { WorkflowContextState, WorkflowSceneKind } from '../../shared/types/workflow'
import type { IndexService } from '../common/indexer/indexService'
import type Database from 'better-sqlite3'
import { NOTES_MODULE_KEY, ROOT_MODULE_KEY } from '../../shared/types/workflow'
import { listFilesByPaths } from '../common/db/statsRepository'

/** 场景变化去抖时长（毫秒）：短于该值的编辑器焦点切换不触发换页 */
const SCENE_DEBOUNCE_MS = 800

export class WorkflowRouter implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>()
    /** 路由事实变更事件：面板据此重新拉取事实并换页 */
    public readonly onChanged: vscode.Event<void> = this.emitter.event

    /** 用户选定的模块：持久保存，未选定为 null（面板展示初始页） */
    private selectedModule: string | null = null
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    /** 上次产出的事实，用于抑制无变化的重复广播 */
    private lastContext: WorkflowContextState | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly indexService: IndexService,
    ) {}

    /** 注册编辑器监听：随扩展订阅一并释放 */
    public register(subscriptions: vscode.Disposable[]): void {
        subscriptions.push(
            this,
            vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
        )
    }

    /** 选定模块并立即广播：使已挂载的面板切到该模块的工作流页 */
    public selectModule(module: string): void {
        this.selectedModule = module
        this.refresh()
    }

    /** 清除模块选定并立即广播：面板据此回到初始页 */
    public clearModule(): void {
        if (this.selectedModule === null) {
            return
        }
        this.selectedModule = null
        this.refresh()
    }

    /** 读取当前路由事实：面板按需拉取与广播共用本方法，读取不改变选定状态 */
    public getContext(): WorkflowContextState {
        const context = this.buildContext()
        this.lastContext = context
        return context
    }

    public dispose(): void {
        this.clearDebounce()
        this.emitter.dispose()
    }

    private scheduleRefresh(): void {
        this.clearDebounce()
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            this.refresh()
        }, SCENE_DEBOUNCE_MS)
    }

    private clearDebounce(): void {
        if (this.debounceTimer === null) {
            return
        }
        clearTimeout(this.debounceTimer)
        this.debounceTimer = null
    }

    /** 广播路由事实：仅在事实变化时发，避免无谓换页 */
    private refresh(): void {
        const next = this.buildContext()
        if (this.isSameAsLast(next)) {
            return
        }
        this.lastContext = next
        this.emitter.fire()
    }

    private isSameAsLast(context: WorkflowContextState): boolean {
        const last = this.lastContext
        return (
            last !== null &&
            last.scene === context.scene &&
            last.module === context.module &&
            last.selectedModule === context.selectedModule
        )
    }

    /** 组装路由事实：仅认可索引库内的文档，无编辑器或索引外文件视为无场景 */
    private buildContext(): WorkflowContextState {
        const selectedModule = this.selectedModule
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            return { scene: 'idle', module: ROOT_MODULE_KEY, selectedModule }
        }
        const relativePath = this.indexService.toRelativePath(editor.document.uri)
        const [known] = listFilesByPaths(this.db, [relativePath])
        if (known === undefined) {
            return { scene: 'idle', module: ROOT_MODULE_KEY, selectedModule }
        }
        const moduleKey = readModuleKey(known.path)
        const scene: WorkflowSceneKind = moduleKey === NOTES_MODULE_KEY ? 'editorNote' : 'idle'
        return { scene, module: moduleKey, selectedModule }
    }
}

/** 取相对路径的一级目录名：与展示层 moduleOf 同口径，顶层文件归入 root */
function readModuleKey(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_KEY
}
