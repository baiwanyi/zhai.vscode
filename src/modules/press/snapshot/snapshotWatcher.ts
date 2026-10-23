/**
 * 快照变更监听：把「用户直接在编辑器里改作品文档并保存」这一类变更接入快照服务。
 * 复用约定：只订阅 onDidSaveTextDocument，命中与否由 snapshotService 按存储根与文件名判定；
 * 工作台经 workspace.fs 的写入不产生保存事件，两条通道不会互相触发。
 * 关键约束：保存事件可能来自任意文件，此处不做路径判断以免逻辑分散；监听须纳入激活期的 subscriptions。
 */
import * as vscode from 'vscode'
import type { PressSnapshotService } from './snapshotService'

/** 注册作品文档保存监听：命中四份文档之一时由服务按统一节流规则留版 */
export function registerPressSnapshotWatcher(
    service: PressSnapshotService,
    disposables: vscode.Disposable[],
): void {
    disposables.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            void service.recordEditorSave(document.uri)
        }),
    )
}
