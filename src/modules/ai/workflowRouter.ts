/**
 * 工作流路由事实服务：汇聚「活跃编辑器场景」「用户选定的模块」与「当前作品」，供工作流面板按模块渲染对应页面。
 * 复用 IndexService.toRelativePath 与索引库回查判定文档归属，与仪表盘活跃笔记回填同口径。
 * 关键约束：编辑器监听随扩展停用释放；切换文档一律立即广播、不做去抖——每个事实都经 isSameAsLast 比对，
 * 同一归属内的文档切换（同作品换章、同为笔记）本身不会产生新事实，跨归属切换则必须实时跟随；
 * 模块选定为持久状态（跨面板重建保留），仅在用户改选、清除，或用户切到另一份文档时变化——
 * 板块选定不能压住用户随后打开的文档，否则从公众号页打开作品/笔记时菜单会停在上一个模块；
 * 广播载荷即变更后的完整事实，订阅端不得回查编辑器重新推导，否则显式打开作品的意图会被旧编辑器状态覆盖；
 * 作品目录以编辑器所在的 press/{作品名}/... 为准；编辑器落在笔记或根目录时视为未打开作品（projectDir 清空），
 * 否则前端会把笔记也判成作品归属，专属分区与对话作用域都切不过去；
 * 仪表盘与工作台打开作品时以显式目录立即广播（该次广播不经编辑器推导），随后编辑器事实与之收敛；
 * 索引尚未收录时仍按路径识别，避免新建作品打不开工作台；
 * 焦点离开文本编辑器（打开设置、切到其它视图）不改变场景事实，沿用上一次的 scene / module / projectDir。
 */
import * as vscode from 'vscode'
import { findIndexedFile } from '@modules/common/db/indexRepository'
import type { IndexService } from '@modules/common/indexer/indexService'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { getActiveDocument, onDidChangeActiveDocument } from '@modules/editor/activeDocument'
import type { WorkflowContextState, WorkflowSceneKind, WorkflowViewRequest } from '@shared/types/workflow'
import { NOTES_MODULE_KEY, ROOT_MODULE_KEY, WECHAT_MODULE_KEY } from '@shared/types/workflow'
import type Database from 'better-sqlite3'

/** 作品文档的最小段数：press/{作品名}/{文档} */
const PRESS_PROJECT_DEPTH = 3

export class WorkflowRouter implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<WorkflowContextState>()
    /**
     * 路由事实变更事件：载荷就是变更后的完整事实，订阅方直接落 state。
     * 关键约束：不得在订阅端回查编辑器重新推导——显式打开作品时编辑器可能尚未切到作品文档，
     * 二次推导会把「打开作品」这一意图覆盖回笔记事实，面板菜单因此不随作品切换。
     */
    public readonly onChanged: vscode.Event<WorkflowContextState> = this.emitter.event

    private readonly viewEmitter = new vscode.EventEmitter<WorkflowViewRequest>()
    /** 页内视图请求事件：宿主发起的一次性跳转（如切到对话分区），不属于路由事实 */
    public readonly onViewRequested: vscode.Event<WorkflowViewRequest> = this.viewEmitter.event
    /** 视图请求序号：同一视图连续请求也递增，前端据此识别新意图 */
    private viewSeq = 0

    /** 用户选定的模块：持久保存，未选定为 null（面板直接进写作管理页的对话分区） */
    private selectedModule: string | null = null
    /** 选定模块时活跃的文档键：与之后的活跃文档不一致，说明用户已切到别的文档，选定随之失效 */
    private selectedModuleDoc: string | null = null
    /** 显式选定的作品目录：仪表盘与工作台打开作品时写入，编辑器不在作品内时以它为准 */
    private projectDir: string | null = null
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
            // 文本与富文本切换统一走活跃文档事实源：事实没变时 refresh 内部会抑制，不需要去抖
            onDidChangeActiveDocument(() => this.refresh()),
        )
    }

    /** 选定模块并立即广播：使已挂载的面板切到该模块的工作流页 */
    public selectModule(module: string): void {
        this.selectedModule = module
        this.selectedModuleDoc = readActiveDocumentKey()
        this.refresh()
    }

    /**
     * 请求面板切到页内视图：只发一次性意图，不写入路由事实。
     * 关键约束：序号自增后随事件下发，前端据此判断是否为新一次请求，
     * 因而不依赖「视图值是否变化」，连续两次跳到同一分区也能生效。
     */
    public requestView(view: string): void {
        this.viewSeq += 1
        this.viewEmitter.fire({ kind: 'view', view, seq: this.viewSeq })
    }

    /**
     * 立即按当前编辑器同步一次事实：打开文档类操作（打开笔记、公众号正文、章节、词库）后调用。
     * 关键约束：与编辑器监听同源推导，显式调用是为了不依赖「事件是否恰好触发」（preserveFocus、
     * 打开的是同一文档等情形不会发出 activeTextEditor 事件），事实没变时由 isSameAsLast 抑制。
     */
    public syncFromEditor(): void {
        this.refresh()
    }

    /** 清除模块选定并立即广播：面板据此回到写作管理页的对话分区 */
    public clearModule(): void {
        if (this.selectedModule === null) {
            return
        }
        this.selectedModule = null
        this.selectedModuleDoc = null
        this.refresh()
    }

    /**
     * 选定作品并立即广播：仪表盘与工作台打开作品后调用。
     * 关键约束：不依赖 activeTextEditor 是否已切到作品文档（webview 抢焦点时编辑器可能短暂缺位），
     * 直接以传入目录广播，工作台据此重新读取作品文档；抑制条件比对完整事实而非仅比对目录，
     * 否则「目录没变、但当前事实仍是笔记/其它模块」时不会广播，菜单停在旧文档上。
     */
    public selectProject(dirPath: string): void {
        this.projectDir = dirPath
        // 打开作品即离开原先的模块选定（如在公众号页选过模块），否则前端会继续按选定模块判归属
        this.dropStaleSelectedModule()
        const next: WorkflowContextState = {
            // 显式打开作品即脱离笔记编辑场景，场景与模块同口径（见 buildContext）
            scene: 'idle',
            module: PRESS_MODULE_DIR,
            selectedModule: this.selectedModule,
            projectDir: dirPath,
        }
        if (this.isSameAsLast(next)) {
            return
        }
        this.lastContext = next
        this.emitter.fire(next)
    }

    /** 清除作品选定并立即广播：作品被删除后调用，工作台据此回到初始页 */
    public clearProject(): void {
        if (this.projectDir === null) {
            return
        }
        this.projectDir = null
        this.dropStaleSelectedModule()
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
        this.emitter.fire(next)
    }

    /** 读取当前路由事实：面板按需拉取与广播共用本方法，读取不改变选定状态 */
    public getContext(): WorkflowContextState {
        const context = this.buildContext()
        this.lastContext = context
        return context
    }

    public dispose(): void {
        this.emitter.dispose()
        this.viewEmitter.dispose()
    }

    /** 广播路由事实：仅在事实变化时发，避免无谓换页 */
    private refresh(): void {
        const next = this.buildContext()
        if (this.isSameAsLast(next)) {
            return
        }
        this.lastContext = next
        this.emitter.fire(next)
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
        const active = getActiveDocument()
        // 模块选定只对「选定当时的那份文档」有效：用户切到别的文档就回到文档驱动，
        // 否则从公众号页打开作品或笔记时，菜单会被残留的选定压住、不跟随当前文档
        this.dropStaleSelectedModule()
        const selectedModule = this.selectedModule
        if (active === null) {
            // 没有活跃文档（打开设置页、切到其它面板）不代表场景改变：
            // 沿用上一次事实与已选定的作品，否则面板会被动跳回初始页
            return {
                scene: this.lastContext?.scene ?? 'idle',
                module: this.lastContext?.module ?? ROOT_MODULE_KEY,
                selectedModule,
                projectDir: this.projectDir,
            }
        }
        const relativePath = this.indexService.toRelativePath(active.uri)
        // 必须用 findIndexedFile：listFilesByPaths 只认 notes/，会把作品与公众号文档判成索引外
        const known = findIndexedFile(this.db, relativePath)
        // 作品目录完全以当前编辑器为准：落在作品内取该作品，落在笔记/根目录则清空。
        // 沿用上一次选定的作品会让前端把笔记也判成作品归属，专属分区与对话作用域都切不过去
        const editorProject = readProjectDir(known?.path ?? relativePath)
        this.projectDir = editorProject
        if (known === null) {
            // 索引尚未收录（如刚创建的笔记、刚解除排除的公众号批次稿）：仍按一级目录识别模块，
            // 否则面板要等下一次索引广播才切到对应归属；作品目录继续以编辑器路径为准
            const moduleKey = readModuleKey(relativePath)
            const isModuleDir =
                moduleKey === NOTES_MODULE_KEY || moduleKey === WECHAT_MODULE_KEY || moduleKey === PRESS_MODULE_DIR
            const fallbackModule = isModuleDir ? moduleKey : editorProject === null ? ROOT_MODULE_KEY : PRESS_MODULE_DIR
            return {
                scene: fallbackModule === NOTES_MODULE_KEY ? 'editorNote' : 'idle',
                module: fallbackModule,
                selectedModule,
                projectDir: this.projectDir,
            }
        }
        const moduleKey = readModuleKey(known.path)
        const scene: WorkflowSceneKind = moduleKey === NOTES_MODULE_KEY ? 'editorNote' : 'idle'
        return { scene, module: moduleKey, selectedModule, projectDir: this.projectDir }
    }

    /**
     * 丢弃已不属于当前文档的模块选定：选定当时记录了活跃文档键，键不一致即为用户已切换文档。
     * 关键约束：活跃文档缺位（焦点在面板、设置页）时不做判断，避免切换焦点就把选定清掉。
     */
    private dropStaleSelectedModule(): void {
        if (this.selectedModule === null) {
            return
        }
        const activeDoc = readActiveDocumentKey()
        if (activeDoc === null || activeDoc === this.selectedModuleDoc) {
            return
        }
        this.selectedModule = null
        this.selectedModuleDoc = null
    }
}

/** 活跃文档键：判断模块选定是否仍属于当前文档，无活跃文档时为 null */
function readActiveDocumentKey(): string | null {
    return getActiveDocument()?.uri.toString() ?? null
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
