/**
 * 文档打开入口：统一决定「用富文本还是用原生文本编辑器」打开 Markdown，并读取当前 tab 的 URI。
 * 复用约定：活跃 tab 的 URI 走 TabInputText / TabInputCustom / TabInputTextDiff 三类输入，
 * 命令与插件内的打开动作共用本文件，不各自读 window.activeTextEditor（富文本 tab 下它为空）。
 * 关键约束：已有文本编辑器 tab 时一律复用，不再新开富文本 tab，避免同一文件出现两个编辑器；
 * openWith 失败必须回退到 vscode.open，不能让「编辑器注册异常」变成「文件打不开」。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'

/** 富文本自定义编辑器的 viewType：与 editorProvider 共用，改名等于既有 tab 失效 */
export const RICH_EDITOR_VIEW_TYPE = 'zhai.markdownEditor'

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

/**
 * 关闭该文档的干净文本 tab：否则 openWith 之后同一文件会同时存在文本与富文本两个 tab。
 * 关键约束：只关未修改的 tab——isDirty 的 tab 里可能有用户没保存的内容，关掉就是丢字。
 */
async function closeCleanTextTabs(uri: vscode.Uri): Promise<number> {
    const target = uri.toString()
    const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
            (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target && !tab.isDirty,
        )
    let closedCount = 0
    for (const tab of tabs) {
        await vscode.window.tabGroups.close(tab)
        closedCount += 1
    }
    return closedCount
}

/**
 * 用富文本编辑器打开文档：插件内所有「打开笔记 / 章节 / 公众号正文」都应走这里。
 * 关键约束：即使该文件已有文本 tab 也切到富文本——插件入口一律富文本是既定行为；
 * 干净的文本 tab 会被关掉以免两个 tab 并存，未保存的文本 tab 保留（宁可多一个 tab 也不丢改动）；
 * openWith 失败必须让用户看见提示，静默回退到文本编辑器会让人以为富文本没生效。
 */
export async function openStorageDocument(uri: vscode.Uri): Promise<void> {
    const closedCount = await closeCleanTextTabs(uri)
    logger.info(`按插件入口打开（富文本）：${uri.fsPath}（关闭干净文本 tab ${String(closedCount)} 个）`)
    try {
        await vscode.commands.executeCommand('vscode.openWith', uri, RICH_EDITOR_VIEW_TYPE)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`富文本编辑器打开失败，回退到文本编辑器：${uri.fsPath}（${reason}）`)
        void vscode.window.showWarningMessage(`富文本编辑器不可用，已改用文本编辑器打开（${reason}）`)
        await vscode.commands.executeCommand('vscode.open', uri)
    }
}
