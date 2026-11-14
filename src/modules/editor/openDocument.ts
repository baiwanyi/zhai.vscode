/**
 * 文档打开入口：统一决定「用富文本还是用原生文本编辑器」打开 Markdown，并读取当前 tab 的 URI。
 * 复用约定：活跃 tab 的 URI 走 TabInputText / TabInputCustom / TabInputTextDiff 三类输入，
 * 命令与插件内的打开动作共用本文件，不各自读 window.activeTextEditor（富文本 tab 下它为空）。
 * 关键约束：同一文档同一时刻只保留一个编辑器 tab——切换形态时先关旧再开新，并把新 tab 挪回原位置，
 * 不在组尾留下「新标签」；目标形态已打开时只激活它，不关闭任何 tab；
 * 旧 tab 有未保存内容时必须先落盘再关，保存失败则中止切换并提示，绝不能丢字；
 * 富文本回写只 applyEdit 不落盘，同样可能 dirty，故按 TextDocument 统一保存；
 * openWith 失败必须回退到 vscode.open，不能让「编辑器注册异常」变成「文件打不开」。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'

/** 富文本自定义编辑器的 viewType：与 editorProvider 共用，改名等于既有 tab 失效 */
export const RICH_EDITOR_VIEW_TYPE = 'zhai.markdownEditor'

/** VSCode 约定的文本编辑器标识：用于从自定义编辑器切回原生文本编辑器 */
const TEXT_EDITOR_VIEW_TYPE = 'default'

/** 编辑器形态：与 viewType 一一对应，切换逻辑只认这两种 */
export type EditorForm = 'rich' | 'text'

const VIEW_TYPE_BY_FORM: Readonly<Record<EditorForm, string>> = {
    rich: RICH_EDITOR_VIEW_TYPE,
    text: TEXT_EDITOR_VIEW_TYPE,
}

/** 同一文档上的一个 tab：带上所属分组，用于取列号与组内原位置 */
interface DocumentTabEntry {
    group: vscode.TabGroup
    tab: vscode.Tab
}

/** 读取当前活跃 tab 对应的文档 URI：不支持的类型返回 undefined */
export function readActiveTabUri(): vscode.Uri | undefined {
    const { activeTab } = vscode.window.tabGroups.activeTabGroup
    if (activeTab === undefined) {
        return undefined
    }
    const input = activeTab.input
    if (input instanceof vscode.TabInputText) {
        return input.uri
    }
    if (input instanceof vscode.TabInputCustom) {
        return input.uri
    }
    if (input instanceof vscode.TabInputTextDiff) {
        return input.modified
    }
    return undefined
}

/** tab 的编辑器形态：只认富文本自定义编辑器与原生文本编辑器，diff 等其它输入返回 null */
function readTabForm(tab: vscode.Tab): EditorForm | null {
    const input = tab.input
    if (input instanceof vscode.TabInputCustom) {
        return input.viewType === RICH_EDITOR_VIEW_TYPE ? 'rich' : null
    }
    if (input instanceof vscode.TabInputText) {
        return 'text'
    }
    return null
}

/**
 * 收集该文档的富文本与文本 tab：diff 标签不算——切换编辑器时不该顺手关掉用户正在对比的视图，
 * 关掉再打开还会丢掉 diff 的两侧定位。
 */
function collectDocumentTabs(uri: vscode.Uri): DocumentTabEntry[] {
    const target = uri.toString()
    const entries: DocumentTabEntry[] = []
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input
            const isSameDocument =
                (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
                input.uri.toString() === target
            if (isSameDocument && readTabForm(tab) !== null) {
                entries.push({ group, tab })
            }
        }
    }
    return entries
}

/**
 * 切换前落盘：关掉旧 tab 之前必须把同一 TextDocument 的未保存改动写进磁盘，
 * 否则用户刚敲的内容会随 tab 一起消失（富文本回写同样只置 dirty，不替用户决定何时写文件）。
 * 返回 false 表示保存失败，调用方须中止切换——宁可让用户手动保存，也不能丢字。
 */
async function saveDocumentBeforeSwitch(uri: vscode.Uri): Promise<boolean> {
    const target = uri.toString()
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.toString() === target)
    if (opened === undefined || !opened.isDirty) {
        return true
    }
    const isSaved = await opened.save()
    if (!isSaved) {
        logger.warn(`切换编辑器前保存失败：${opened.uri.fsPath}`)
    }
    return isSaved
}

/**
 * 把刚打开的新 tab 挪回旧 tab 的位置：openWith 只会把新 tab 追加到组尾，
 * 不移回原位的话，即便只开着一个文件，切一次形态也会看到标签跳到最右侧。
 * 位置回填只影响观感，失败不再打扰用户。
 */
async function restoreTabPosition(targetIndex: number, currentIndex: number): Promise<void> {
    if (targetIndex < 0 || currentIndex <= 0 || targetIndex >= currentIndex) {
        return
    }
    const steps = currentIndex - targetIndex
    try {
        for (let step = 0; step < steps; step += 1) {
            await vscode.commands.executeCommand('workbench.action.moveEditorLeftInGroup')
        }
    } catch (error) {
        logger.debug(`切换编辑器后移动标签失败：${String(error)}`)
    }
}

/**
 * 以指定形态打开文档，并保证同一文档只剩这一个编辑器 tab。
 * 关键约束：目标形态已存在时只激活（同 viewType + 同 URI 会复用该 tab），不动其它 tab；
 * 需要换形态时先保存再关闭旧 tab，再按原列打开，最后把新 tab 移回原组内位置。
 */
export async function openDocumentWith(uri: vscode.Uri, form: EditorForm): Promise<void> {
    const viewType = VIEW_TYPE_BY_FORM[form]
    const entries = collectDocumentTabs(uri)
    const existing = entries.find((entry) => readTabForm(entry.tab) === form)
    if (existing !== undefined) {
        await vscode.commands.executeCommand('vscode.openWith', uri, viewType, existing.group.viewColumn)
        return
    }
    if (!(await saveDocumentBeforeSwitch(uri))) {
        void vscode.window.showWarningMessage('文档有未保存的修改且保存失败，切换编辑器已取消；请先手动保存')
        return
    }
    const origin = entries[0]
    const column = origin?.group.viewColumn
    // 关旧 tab 前记下位置：新 tab 会落在组尾，随后要挪回原位
    const originIndex = origin === undefined ? -1 : origin.group.tabs.indexOf(origin.tab)
    const closedInGroup =
        origin === undefined ? 0 : entries.filter((entry) => entry.group.viewColumn === origin.group.viewColumn).length
    const openedIndex = origin === undefined ? -1 : origin.group.tabs.length - closedInGroup
    for (const entry of entries) {
        // preserveFocus：关掉时不抢焦点，避免中间态把用户的输入上下文切走
        await vscode.window.tabGroups.close(entry.tab, true)
    }
    logger.info(`按${form === 'rich' ? '富文本' : '文本'}形态打开：${uri.fsPath}`)
    try {
        await vscode.commands.executeCommand('vscode.openWith', uri, viewType, column)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`指定编辑器打开失败，回退到默认打开方式：${uri.fsPath}（${reason}）`)
        void vscode.window.showWarningMessage(`编辑器不可用，已改用默认方式打开（${reason}）`)
        await vscode.commands.executeCommand('vscode.open', uri)
        return
    }
    await restoreTabPosition(originIndex, openedIndex)
}

/** 用富文本编辑器打开文档：插件内所有「打开笔记 / 章节 / 公众号正文」都应走这里 */
export async function openStorageDocument(uri: vscode.Uri): Promise<void> {
    await openDocumentWith(uri, 'rich')
}
