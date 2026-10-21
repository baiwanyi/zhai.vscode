/**
 * 写作管理 AI 协议路由：把 pressAi/* 消息分发到人物外貌与角色设定图两个服务，入参收窄由服务层完成。
 * 复用约定：由 AiChatViewProvider 按前缀统一委托，本类只做方法到服务的映射；
 * 前缀刻意与仪表盘的作品协议 press/* 区分，避免两类消息在同一层混淆。
 * 关键约束：只有生成、删除与取消三类方法；磁盘 Uri 转 URL 的能力由调用方注入，路由不持有视图。
 */
import type { PortraitService } from './portraitService'
import type { PressAiService } from './pressAiService'
import type * as vscode from 'vscode'

export class PressRoutes {
    public constructor(
        private readonly service: PressAiService,
        private readonly portraits: PortraitService,
    ) {}

    /**
     * 处理写作管理 AI 协议方法
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async handle(method: string, payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<unknown> {
        switch (method) {
            case 'pressAi/aiAppearance':
                return this.service.generateAppearance(payload)
            case 'pressAi/aiAppearance/abort':
                return this.service.abortAppearance()
            case 'pressAi/generatePortrait':
                return this.portraits.generate(payload, toWebviewUri)
            case 'pressAi/deletePortrait':
                return this.portraits.remove(payload)
            case 'pressAi/aiPortrait/abort':
                return this.portraits.abort()
            default:
                throw new Error(`未知的写作管理协议方法：${method}`)
        }
    }
}
