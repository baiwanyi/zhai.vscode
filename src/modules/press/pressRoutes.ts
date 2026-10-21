/**
 * 写作管理 AI 协议路由：把 pressAi/* 消息分发到 PressAiService，入参收窄由服务层完成。
 * 复用约定：由 AiChatViewProvider 按前缀统一委托，本类只做方法到服务的映射；
 * 前缀刻意与仪表盘的作品协议 press/* 区分，避免两类消息在同一层混淆。
 * 关键约束：只暴露一次性生成与取消两个方法，不在此直接触达数据库或密钥。
 */
import type { PressAiService } from './pressAiService'

export class PressRoutes {
    public constructor(private readonly service: PressAiService) {}

    /** 处理写作管理 AI 协议方法 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'pressAi/aiAppearance':
                return this.service.generateAppearance(payload)
            case 'pressAi/aiAppearance/abort':
                return this.service.abortAppearance()
            default:
                throw new Error(`未知的写作管理协议方法：${method}`)
        }
    }
}
