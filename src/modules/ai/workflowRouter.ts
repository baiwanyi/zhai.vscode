/**
 * 工作流路由事实服务：汇聚「活跃编辑器场景」「用户选定的模块」与「当前作品」，供工作流面板按模块渲染对应页面。
 * 复用 IndexService.toRelativePath 与索引库回查判定文档归属，与仪表盘活跃笔记回填同口径。
 * 关键约束：编辑器监听随扩展停用释放；场景变化经去抖后再广播，避免编辑器焦点抖动导致面板反复换页；
 * 模块选定为持久状态（跨面板重建保留），仅在用户改选或清除时变化，未选定时由面板展示初始页；
 * 作品目录优先取编辑器所在的 press/{作品名}/...，编辑器不在作品内时沿用显式选定值（selectProject 写入），
 * 索引尚未收录时仍按路径识别，避免新建作品打不开工作台；
 * 焦点离开文本编辑器（打开设置、切到其它视图）不改变场景事实，沿用上一次的 scene / module / projectDir。
 */
import * as vscode from 'vscode'
import type { WorkflowContextState, WorkflowSceneKind } from '../../shared/types/workflow'
import type { IndexService } from '../common/indexer/indexService'
import type Database from 'better-sqlite3'
import { NOTES_MODULE_KEY, ROOT_MODULE_KEY } from '../../shared/types/workflow'
import { listFilesByPaths } from '../common/db/statsRepository'
import { PRESS_MODULE_DIR } from '../common/projectPath'

/** 场景变化去抖时长（毫秒）：短于该值的编辑器焦点切换不触发换页 */
const SCENE_DEBOUNCE_MS = 800

/** 作品文档的最小段数：press/{作品名}/{文档} */
const PRESS_PROJECT_DEPTH = 3

export class WorkflowRouter implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>()
    /** 路由事实变更事件：面板据此重新拉取事实并换页 */
    public readonly onChanged: vscode.Event<void> = this.emitter.event

    /** 用户选定的模块：持久保存，未选定为 null（面板展示初始页） */
    private selectedModule: string | null = null
    /** 显式选定的作品目录：仪表盘与工作台打开作品时写入，编辑器不在作品内时以它为准 */
    private projectDir: string | null = null
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

    /**
     * 选定作品并立即广播：仪表盘与工作台打开作品后调用。
     * 关键约束：不依赖 activeTextEditor 是否已切到作品文档（webview 抢焦点时编辑器可能短暂缺位），
     * 直接以传入目录广播，工作台据此重新读取作品文档；同一目录重复打开不重复广播。
     */
    public selectProject(dirPath: string): void {
        if (this.projectDir === dirPath) {
            return
        }
        this.projectDir = dirPath
        const next: WorkflowContextState = {
            scene: this.lastContext?.scene ?? 'idle',
            module: PRESS_MODULE_DIR,
            selectedModule: this.selectedModule,
            projectDir: dirPath,
        }
        if (this.isSameAsLast(next)) {
            return
        }
        this.lastContext = next
        this.emitter.fire()
    }

    /** 清除作品选定并立即广播：作品被删除后调用，工作台据此回到初始页 */
    public clearProject(): void {
        if (this.projectDir === null) {
            return
        }
        this.projectDir = null
        const next: WorkflowContextState = {
            scene: this.lastContext?.scene ?? 'idle',
            module: PRESS_MODULE_DIR,
            selectedModule: this.selectedModule,
            projectDir: null,
        }
        if (this.isSameAsLast(next)) {
            return
        }
        this.lastContext = next
        this.emitter.fire()
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
            last.selectedModule === context.selectedModule &&
            last.projectDir === context.projectDir
        )
    }

    /** 组装路由事实：仅认可索引库内的文档，索引外文件视为无场景；作品目录以编辑器为准，缺位时沿用选定值 */
    private buildContext(): WorkflowContextState {
        const selectedModule = this.selectedModule
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            // 焦点不在文本编辑器（打开设置页、切到其它面板）不代表场景改变：
            // 沿用上一次事实与已选定的作品，否则面板会被动跳回初始页
            return {
                scene: this.lastContext?.scene ?? 'idle',
                module: this.lastContext?.module ?? ROOT_MODULE_KEY,
                selectedModule,
                projectDir: this.projectDir,
            }
        }
        const relativePath = this.indexService.toRelativePath(editor.document.uri)
        const [known] = listFilesByPaths(this.db, [relativePath])
        // 编辑器落在 press 作品内时以编辑器为准；其余文档（笔记、根目录文件）沿用已选定的作品
        const editorProject = readProjectDir(known?.path ?? relativePath)
        if (editorProject !== null) {
            this.projectDir = editorProject
        }
        if (known === undefined) {
            // 索引尚未收录（如刚创建的作品）：仍按路径识别作品，让写作管理页能立即载入，
            // 否则面板要等下一次索引广播才有内容
            return {
                scene: 'idle',
                module: editorProject === null ? ROOT_MODULE_KEY : PRESS_MODULE_DIR,
                selectedModule,
                projectDir: this.projectDir,
            }
        }
        const moduleKey = readModuleKey(known.path)
        const scene: WorkflowSceneKind = moduleKey === NOTES_MODULE_KEY ? 'editorNote' : 'idle'
        return { scene, module: moduleKey, selectedModule, projectDir: this.projectDir }
    }
}

/** 取相对路径的一级目录名：与展示层 moduleOf 同口径，顶层文件归入 root */
function readModuleKey(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_KEY
}

/** 从文档相对路径推导作品目录：仅认 press/{作品名}/... 至少三段，其余一律视为未打开作品 */
function readProjectDir(relativePath: string): string | null {
    const segments = relativePath.split('/')
    const [moduleKey, projectName] = segments
    if (segments.length < PRESS_PROJECT_DEPTH || moduleKey !== PRESS_MODULE_DIR) {
        return null
    }
    if (projectName === undefined || projectName.length === 0) {
        return null
    }
    return `${PRESS_MODULE_DIR}/${projectName}`
}
