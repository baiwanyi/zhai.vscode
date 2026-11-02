/**
 * 笔记重命名监听：把「用户在编辑器里改了一级标题并保存」接入重命名服务。
 * 复用约定：只订阅 onDidSaveTextDocument，命中与否由 noteRenameService 按存储根与 notes/ 前缀判定；
 * 宿主经 workspace.fs 的写入不产生保存事件，两条通道不会互相触发。
 * 关键约束：保存事件可能来自任意文件，此处不做路径判断以免逻辑分散；监听须纳入激活期的 subscriptions。
 */
import * as vscode from 'vscode'
import type { NoteRenameService } from './noteRenameService'

/** 注册笔记保存监听：由服务自行判定是否属于笔记 */
export function registerNoteRenameWatcher(service: NoteRenameService, disposables: vscode.Disposable[]): void {
    disposables.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            void service.handleSave(document)
        }),
    )
}
