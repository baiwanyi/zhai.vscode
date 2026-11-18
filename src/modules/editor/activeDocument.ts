/**
 * 活跃文档事实源：统一记录编辑器里的文档及类型（文本 / 富文本），供工作流路由与插入目标读取。
 * 复用约定：文本编辑器事件由本文件订阅，富文本侧由 editorProvider 上报；口径与 WorkflowRouter 一致——
 * 焦点移到面板或设置页不清空，沿用最后一次活跃文档，避免打开设置就把场景事实丢掉。
 * 关键约束：模块级单例，随激活注册一次；业务代码不得再直接读 window.activeTextEditor——
 * 富文本 tab 下它为空，绕过本文件会静默失效或插到错误文档；
 * 注册时必须把「启动时已经打开的那份文档」登记进来：VSCode 恢复会话时不会为初始编辑器补发切换事件，
 * 不登记就会让工作流路由一直读到 null，非 md 文件因此按默认放行进工作流区；
 * 编辑器形态切换（文本 ↔ 富文本）用 withActiveDocumentHold 包住：切换要先关旧 tab 再开新 tab，
 * 关旧 tab 会让 VSCode 短暂激活相邻文档，中间事实一旦广播出去，工作流面板就会切走再切回、页面被重建。
 */
import * as vscode from 'vscode'
import type { EditorInsertContent } from '@shared/types/editor'

/** 活跃文档：kind 决定后续能否拿到 TextEditor，rich 只用于路由与展示 */
export interface ActiveDocument {
    uri: vscode.Uri
    kind: 'text' | 'rich'
}

const emitter = new vscode.EventEmitter<ActiveDocument | null>()

/** 活跃文档变更事件：文本与富文本切换统一从这里广播 */
export const onDidChangeActiveDocument: vscode.Event<ActiveDocument | null> = emitter.event

let current: ActiveDocument | null = null
/** 切换事务深度：形态切换期间关闭旧 tab 会短暂把相邻文档变成活跃文档 */
let holdDepth = 0
/** 事务期间收到的最新事实：undefined 表示期间没有任何变化 */
let heldDocument: ActiveDocument | null | undefined

/** 两份活跃文档是否指同一形态的同一文档：用于抑制事务结束时的无意义广播 */
function isSameDocument(left: ActiveDocument | null, right: ActiveDocument | null): boolean {
    if (left === null || right === null) {
        return left === right
    }
    return left.kind === right.kind && left.uri.toString() === right.uri.toString()
}

/** 更新事实并广播：调用方按变化与否自行去重（事件量很小，不去抖） */
function setActiveDocument(next: ActiveDocument | null): void {
    // 事务期间只暂存，不改变对外事实：切换编辑器时相邻 tab 的活跃事件不是用户意图
    if (holdDepth > 0) {
        heldDocument = next
        return
    }
    current = next
    emitter.fire(next)
}

/**
 * 在「活跃文档不变」的前提下执行一次编辑器形态切换：事务期间的事实变化只暂存、不广播，
 * 结束后按最终事实广播一次，与切换前一致时完全不广播。
 * 关键约束：只用于同一份文档的形态切换——调用方须在事务内显式上报最终形态
 * （reportRichDocument / reportTextDocument），不能依赖事件时序，否则事务结束时会把中间态当结果。
 */
export async function withActiveDocumentHold<T>(task: () => Promise<T>): Promise<T> {
    holdDepth += 1
    try {
        return await task()
    } finally {
        holdDepth -= 1
        if (holdDepth === 0) {
            releaseHeldDocument()
        }
    }
}

/** 释放事务期间暂存的事实：与切换前相同则保持静默，避免订阅方白跑一轮 */
function releaseHeldDocument(): void {
    const next = heldDocument
    heldDocument = undefined
    if (next === undefined || isSameDocument(current, next)) {
        return
    }
    current = next
    emitter.fire(next)
}

/**
 * 启动时的活跃文档：优先取文本编辑器；面板已抢走焦点时 activeTextEditor 为空，退回活跃 tab。
 * 关键约束：只认普通文本 tab —— 自定义编辑器（宅写作编辑器）由 reportRichDocument 上报，
 * 在这里按 tab 类型推断 kind 会与其真实生命周期打架。
 */
function readInitialDocument(): ActiveDocument | null {
    const editor = vscode.window.activeTextEditor
    if (editor !== undefined) {
        return { uri: editor.document.uri, kind: 'text' }
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (tab === undefined || !(tab.input instanceof vscode.TabInputText)) {
        return null
    }
    return { uri: tab.input.uri, kind: 'text' }
}

/** 注册文本编辑器监听并托管 emitter：随 context.subscriptions 释放 */
export function trackActiveDocument(subscriptions: vscode.Disposable[]): void {
    // 恢复会话时不补发切换事件：注册前先登记一次，工作流路由与插入目标才有「当前文档」可读
    const initial = readInitialDocument()
    if (initial !== null) {
        setActiveDocument(initial)
    }
    subscriptions.push(
        emitter,
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor === undefined) {
                // 焦点离开编辑器不清空：与工作流路由同一口径
                return
            }
            setActiveDocument({ uri: editor.document.uri, kind: 'text' })
        }),
    )
}

/**
 * 富文本编辑器上报活跃状态：打开或获得焦点时调用。
 * 关键约束：只在 panel 处于 active 时上报，避免后台 tab 抢走活跃事实。
 */
export function reportRichDocument(uri: vscode.Uri): void {
    setActiveDocument({ uri, kind: 'rich' })
}

/**
 * 文本编辑器上报活跃状态：切回原生文本编辑器时由打开入口显式调用。
 * 关键约束：不依赖 onDidChangeActiveTextEditor 的派发时机——切换事务结束时事件可能还没到，
 * 事务若以中间态收尾会把面板带到相邻文档。
 */
export function reportTextDocument(uri: vscode.Uri): void {
    setActiveDocument({ uri, kind: 'text' })
}

/**
 * 富文本内定位处理器：由编辑层注册，供校对、标注跳转等模块调用。
 * 用注册点而不是层层注入——调用方（proofread / routes）不该知道编辑器实现。
 */
type RichRevealHandler = (uri: vscode.Uri, request: { quote: string; blockIndex: number }) => boolean

let richRevealHandler: RichRevealHandler | null = null

export function setRichRevealHandler(handler: RichRevealHandler | null): void {
    richRevealHandler = handler
}

/** 若该文档已在富文本打开则就地定位；返回 false 表示调用方应回落到文本编辑器 */
export function revealInRichDocument(uri: vscode.Uri, request: { quote: string; blockIndex: number }): boolean {
    return richRevealHandler === null ? false : richRevealHandler(uri, request)
}

/** 富文本插入处理器：上传、图库等模块把内容送进富文本时调用，不需要知道编辑器实现 */
type RichInsertHandler = (uri: vscode.Uri, content: EditorInsertContent) => boolean

let richInsertHandler: RichInsertHandler | null = null

export function setRichInsertHandler(handler: RichInsertHandler | null): void {
    richInsertHandler = handler
}

/** 若该文档已在富文本打开则插入内容；返回 false 表示没有可用的富文本实例 */
export function insertIntoRichDocument(uri: vscode.Uri, content: EditorInsertContent): boolean {
    return richInsertHandler === null ? false : richInsertHandler(uri, content)
}

/** 富文本选区快照：引用与写回只需要 anchor 文本，不需要 ProseMirror 位置 */
export interface RichSelectionSnapshot {
    quote: string
    blockIndex: number
    isEmpty: boolean
}

/** 富文本选区读取器：由编辑层注册，供 AI 引用与写回定位使用 */
type RichSelectionReader = (uri: vscode.Uri) => RichSelectionSnapshot | null

let richSelectionReader: RichSelectionReader | null = null

export function setRichSelectionReader(reader: RichSelectionReader | null): void {
    richSelectionReader = reader
}

/** 读最近一次上报的选区；返回 null 表示该文档没有富文本实例或用户还没动过选区 */
export function readRichSelection(uri: vscode.Uri): RichSelectionSnapshot | null {
    return richSelectionReader === null ? null : richSelectionReader(uri)
}

/** 富文本编辑器关闭：只有当前活跃的正是它时才清空，避免关后台 tab 误清别的文档 */
export function clearRichDocument(uri: vscode.Uri): void {
    if (current?.kind === 'rich' && current.uri.toString() === uri.toString()) {
        setActiveDocument(null)
    }
}

/** 读取当前活跃文档：未打开任何文档或尚未收到事件时为 null */
export function getActiveDocument(): ActiveDocument | null {
    return current
}

/** 取文本编辑器：活跃文档是富文本时返回 undefined，调用方必须处理该分支 */
export function getActiveTextEditor(): vscode.TextEditor | undefined {
    if (current?.kind === 'rich') {
        return undefined
    }
    return vscode.window.activeTextEditor
}
