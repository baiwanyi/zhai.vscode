/**
 * 状态栏：展示索引状态与当前 AI 模型，点击跳转仪表盘。
 * 设计源：docs/modules/common.md C11；仅展示，不做轮询，由索引事件驱动刷新。
 */
import * as vscode from 'vscode'
import { getZhaiConfig } from './config'
import type { IndexService, IndexStatus } from './indexer/indexService'

export class StatusBarService {
    private readonly item: vscode.StatusBarItem

    public constructor(
        private readonly indexService: IndexService,
        private readonly indexStatusEvent: vscode.Event<IndexStatus>,
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
        this.item.command = 'zhai.openDashboard'
        this.item.name = 'Zhai 索引状态'
        this.refresh(indexService.getStatus())
    }

    public register(subscriptions: vscode.Disposable[]): void {
        subscriptions.push(this.item)
        const disposable = this.indexStatusEvent(() => this.refresh(this.indexService.getStatus()))
        subscriptions.push(disposable)
    }

    private refresh(status: IndexStatus): void {
        const model = getZhaiConfig().aiModel
        const indexText = status.isRebuilding ? '$(sync~spin) 索引重建中' : `$(database) ${status.indexedCount}`
        this.item.text = `${indexText} · ${model}`
        this.item.tooltip = `已索引 ${status.indexedCount} 个文件\n上次构建：${status.lastBuiltAt ?? '从未'}\n点击打开仪表盘`
    }

    public dispose(): void {
        this.item.dispose()
    }
}
