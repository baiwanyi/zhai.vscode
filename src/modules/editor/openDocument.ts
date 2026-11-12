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

/** 该 URI 是否已有文本编辑器 tab：有则复用，避免与富文本 tab 并存 */
function hasTextTab(uri: vscode.Uri): boolean {
    const target = uri.toString()
    return vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target),
    )
}

/**
 * 用富文本编辑器打开文档：已有文本 tab 时聚焦复用，否则 openWith 自定义编辑器。
 * 插件内所有「打开笔记 / 章节 / 公众号正文」都应走这里，资源管理器打开不受影响。
 */
export async function openStorageDocument(uri: vscode.Uri): Promise<void> {
    if (hasTextTab(uri)) {
        await vscode.commands.executeCommand('vscode.open', uri)
        return
    }
    try {
        await vscode.commands.executeCommand('vscode.openWith', uri, RICH_EDITOR_VIEW_TYPE)
    } catch (error) {
        logger.warn(
            `富文本编辑器打开失败，回退到文本编辑器：${uri.fsPath}（${
                error instanceof Error ? error.message : String(error)
            }）`,
        )
        await vscode.commands.executeCommand('vscode.open', uri)
    }
}
