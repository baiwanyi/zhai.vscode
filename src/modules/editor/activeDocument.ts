/**
 * 活跃文档事实源：统一记录编辑器里的文档及类型（文本 / 富文本），供工作流路由与插入目标读取。
 * 复用约定：文本编辑器事件由本文件订阅，富文本侧由 editorProvider 上报；口径与 WorkflowRouter 一致——
 * 焦点移到面板或设置页不清空，沿用最后一次活跃文档，避免打开设置就把场景事实丢掉。
 * 关键约束：模块级单例，随激活注册一次；业务代码不得再直接读 window.activeTextEditor——
 * 富文本 tab 下它为空，绕过本文件会静默失效或插到错误文档。
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

/** 更新事实并广播：调用方按变化与否自行去重（事件量很小，不去抖） */
function setActiveDocument(next: ActiveDocument | null): void {
    current = next
    emitter.fire(next)
}

/** 注册文本编辑器监听并托管 emitter：随 context.subscriptions 释放 */
export function trackActiveDocument(subscriptions: vscode.Disposable[]): void {
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
