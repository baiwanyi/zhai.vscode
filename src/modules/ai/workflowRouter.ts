/**
 * 工作流路由事实服务：汇聚「活跃编辑器场景」与「入口跳转意图」，供工作流面板按场景渲染对应页面。
 * 复用 IndexService.toRelativePath 与索引库回查判定文档归属，与仪表盘活跃笔记回填同口径。
 * 关键约束：编辑器监听随扩展停用释放；场景变化经去抖后再广播，避免编辑器焦点抖动导致面板反复换页；
 * 入口意图为一次性值，读取即消费，防止长期压住场景判定。
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

    /** 入口一次性意图：被 consumeContext 读取后即失效 */
    private pendingModule: string | null = null
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

    /** 记录入口跳转意图并立即广播：使已挂载的面板按新场景换页 */
    public requestModule(module: string): void {
        this.pendingModule = module
        this.refresh()
    }

    /** 读取并消费当前路由事实：面板按需拉取与广播共用本方法，保证意图只生效一次 */
    public consumeContext(): WorkflowContextState {
        const context = this.buildContext()
        this.pendingModule = null
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

    /** 广播路由事实：存在入口意图时必发，否则仅在事实变化时发，避免无谓换页 */
    private refresh(): void {
        const next = this.buildContext()
        if (this.pendingModule === null && this.isSameAsLast(next)) {
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
            last.requestedModule === context.requestedModule
        )
    }

    /** 组装路由事实：仅认可索引库内的文档，无编辑器或索引外文件视为无场景 */
    private buildContext(): WorkflowContextState {
        const requestedModule = this.pendingModule
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            return { scene: 'idle', module: ROOT_MODULE_KEY, requestedModule }
        }
        const relativePath = this.indexService.toRelativePath(editor.document.uri)
        const [known] = listFilesByPaths(this.db, [relativePath])
        if (known === undefined) {
            return { scene: 'idle', module: ROOT_MODULE_KEY, requestedModule }
        }
        const moduleKey = readModuleKey(known.path)
        const scene: WorkflowSceneKind = moduleKey === NOTES_MODULE_KEY ? 'editorNote' : 'idle'
        return { scene, module: moduleKey, requestedModule }
    }
}

/** 取相对路径的一级目录名：与展示层 moduleOf 同口径，顶层文件归入 root */
function readModuleKey(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_KEY
}
