/**
 * 宿主操作反馈出口：把命令执行结果推给 Workflow 面板，由前端统一用 sonner 呈现。
 * 复用约定：命令层经 notify 上报，返回 false 时由调用方回退到 VS Code 原生提示，避免反馈静默丢失。
 * 关键约束：反馈集中在 Workflow 面板显示（仪表盘不订阅该通道，避免同一提示在两个面板各弹一次）；
 * 视图计数只由 AiChatViewProvider 在 resolve / dispose 时维护，命令层不接触视图实例；
 * 载荷只有级别与文案，不收路径与对象，防止前端拿到可执行内容。
 */
import * as vscode from 'vscode'
import type { ToastLevel, ToastPayload } from '../../shared/types/messages'

export class ToastService implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<ToastPayload>()
    /** 已打开的 Webview 数量：为 0 时没有地方能显示 sonner，需要调用方回退原生提示 */
    private viewCount = 0

    /** 反馈事件：各 Provider 订阅后转发给自身视图 */
    public readonly onToast: vscode.Event<ToastPayload> = this.emitter.event

    public attach(): void {
        this.viewCount += 1
    }

    public detach(): void {
        this.viewCount = Math.max(this.viewCount - 1, 0)
    }

    /** 推送操作反馈：有视图时由 sonner 显示并返回 true，无视图返回 false */
    public notify(level: ToastLevel, message: string): boolean {
        if (this.viewCount === 0) {
            return false
        }
        this.emitter.fire({ level, message })
        return true
    }

    /**
     * 推送操作反馈并按需兜底：没有 Webview 时回退 VS Code 原生通知，
     * 保证从命令面板触发（面板未打开）的操作结果不会静默丢失。
     */
    public notifyOrShow(level: ToastLevel, message: string): void {
        if (this.notify(level, message)) {
            return
        }
        if (level === 'error') {
            void vscode.window.showErrorMessage(message)
            return
        }
        if (level === 'warning') {
            void vscode.window.showWarningMessage(message)
            return
        }
        void vscode.window.showInformationMessage(message)
    }

    public dispose(): void {
        this.emitter.dispose()
    }
}
