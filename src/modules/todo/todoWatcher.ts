/**
 * 待办文件监听：todo 目录下的 md 被外部改动时通知服务，由面板刷新清单与条目。
 * 复用约定：监听范围由 RelativePattern 限定在 todo/*.md，不订阅整个存储根；
 * 变更经短防抖合并，连续保存只刷新一次。
 * 关键约束：程序自身写入同样会触发监听，服务侧用写入静默窗口过滤，避免刚写完就重复回读；
 * 监听器随扩展激活注册、随 subscriptions 释放，不单独判断目录是否存在（缺失时不会命中任何事件）。
 */
import * as vscode from 'vscode'
import type { TodoRepository } from './todoRepository'
import type { TodoService } from './todoService'

/** 变更防抖：编辑器连续保存会在极短时间内产生多次事件，合并成一次刷新 */
const DEBOUNCE_MS = 300

export class TodoWatcher implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = []
    private timer: ReturnType<typeof setTimeout> | null = null

    public constructor(
        private readonly service: TodoService,
        repository: TodoRepository,
    ) {
        const pattern = new vscode.RelativePattern(repository.dirUri(), '*.md')
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        // 增删改名都会改变清单结构，与内容变更同等对待
        this.disposables.push(
            watcher,
            watcher.onDidChange(() => this.schedule()),
            watcher.onDidCreate(() => this.schedule()),
            watcher.onDidDelete(() => this.schedule()),
        )
    }

    public dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.disposables.length = 0
    }

    /** 防抖后通知：落在写入静默窗口内的事件由服务自行丢弃 */
    private schedule(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer)
        }
        this.timer = setTimeout(() => {
            this.timer = null
            if (this.service.isRecentlyWritten()) {
                return
            }
            this.service.notifyChanged()
        }, DEBOUNCE_MS)
    }
}
