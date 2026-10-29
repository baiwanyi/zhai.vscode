/**
 * CodeBuddy SDK 适配层：把 @tencent-ai/agent-sdk 的入口收敛成可注入接口，供文本与图像两个通道共用。
 * 复用约定：通道只依赖本接口，不直接 import SDK；默认实现 sdkCodebuddyClient 只做透传，
 * 重试、超时、错误包装与计费保护一律留在通道层，避免适配层长出策略。
 * 关键约束：接口只暴露调用方实际用到的能力，新增方法前必须先有调用方；
 * 单测通过替换 client 覆盖流事件解析与产物解析，不得为了可测性在通道里加分支。
 */
import { query, unstable_v2_createSession, unstable_v2_resumeSession } from '@tencent-ai/agent-sdk'
import type { Message, Options, SessionOptions, UserMessage } from '@tencent-ai/agent-sdk'

/** V2 Session 的最小能力集：文本通道只用到这六项 */
export interface CodebuddySession {
    connect(): Promise<void>
    send(message: string | UserMessage): Promise<void>
    stream(): AsyncGenerator<Message, void>
    interrupt(): Promise<void>
    setConfig(config: Record<string, unknown>): Promise<void>
    close(): void
}

/**
 * 一次性查询的最小能力集：出图按单次任务消费消息流，中断经 Options.abortController 下发。
 * 关键约束：只约束可迭代能力，不要求 AsyncGenerator —— SDK 的 Query 未实现 asyncDispose，套不上完整接口。
 */
export type CodebuddyQuery = AsyncIterable<Message>

/** 两个通道对 SDK 的唯一依赖 */
export interface CodebuddyClient {
    createSession(options: SessionOptions): CodebuddySession
    resumeSession(sessionId: string, options: SessionOptions): CodebuddySession
    query(params: { prompt: string | AsyncIterable<UserMessage>; options?: Options }): CodebuddyQuery
}

/** 默认实现：直接转给 SDK，不做任何额外处理 */
export const sdkCodebuddyClient: CodebuddyClient = {
    createSession: (options: SessionOptions): CodebuddySession => unstable_v2_createSession(options),
    resumeSession: (sessionId: string, options: SessionOptions): CodebuddySession =>
        unstable_v2_resumeSession(sessionId, options),
    query: (params: { prompt: string | AsyncIterable<UserMessage>; options?: Options }): CodebuddyQuery => query(params),
}
