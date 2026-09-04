/**
 * 日志与诊断：基于 OutputChannel 的分级日志，供命令面板查看与诊断导出使用。
 * 约束：日志内容禁止包含 API Key、Token 等敏感字段。
 */
import * as vscode from 'vscode'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 全局日志器（单例），由 extension.ts 初始化 */
class ZhaiLogger {
    private channel: vscode.OutputChannel | null = null

    /** 初始化输出通道，须在 activate 中最先调用 */
    public init(channel: vscode.OutputChannel): void {
        this.channel = channel
    }

    public debug(message: string): void {
        this.write('debug', message)
    }

    public info(message: string): void {
        this.write('info', message)
    }

    public warn(message: string): void {
        this.write('warn', message)
    }

    public error(message: string, error?: unknown): void {
        const detail = error instanceof Error ? error.stack ?? error.message : ''
        this.write('error', detail.length > 0 ? `${message}\n${detail}` : message)
    }

    public show(): void {
        this.channel?.show(true)
    }

    public dispose(): void {
        this.channel?.dispose()
        this.channel = null
    }

    private write(level: LogLevel, message: string): void {
        if (!this.channel) {
            return
        }
        const time = new Date().toISOString()
        this.channel.appendLine(`[${time}] [${level.toUpperCase()}] ${message}`)
    }
}

export const logger = new ZhaiLogger()
