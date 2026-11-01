/**
 * CodeBuddy SDK 适配层：把 @tencent-ai/agent-sdk 的入口收敛成可注入接口，供文本与图像两个通道共用。
 * 复用约定：通道只依赖本接口，不直接 import SDK；默认实现 sdkCodebuddyClient 只做透传，
 * 重试、超时、错误包装与计费保护一律留在通道层，避免适配层长出策略。
 * 关键约束：接口只暴露调用方实际用到的能力，新增方法前必须先有调用方；全链路统一走 V2 Session，
 * 出图产物由通道解析内容块与文本候选，不依赖结构化输出；
 * SDK 首次 require 约 350ms（激活耗时的大头），故改为首次建会话时才动态加载，
 * 两个建会话方法因此返回 Promise，调用方必须 await；
 * 单测通过替换 client 覆盖流事件解析与产物解析，不得为了可测性在通道里加分支。
 */
import type * as agentSdk from '@tencent-ai/agent-sdk'
import type { Message, SessionOptions, UserMessage } from '@tencent-ai/agent-sdk'

/** SDK 模块类型：只在首次建会话时加载一次，后续调用复用同一份 */
type AgentSdk = typeof agentSdk

let sdkHandle: Promise<AgentSdk> | null = null

/** 惰性加载 SDK：失败时清空句柄，避免一次异常让后续调用永远命中同一个 rejected Promise */
function loadAgentSdk(): Promise<AgentSdk> {
    sdkHandle ??= import('@tencent-ai/agent-sdk').catch((error: unknown) => {
        sdkHandle = null
        throw error
    })
    return sdkHandle
}

/** V2 Session 的最小能力集：文本与图像通道共用这六项 */
export interface CodebuddySession {
    connect(): Promise<void>
    send(message: string | UserMessage): Promise<void>
    stream(): AsyncGenerator<Message, void>
    interrupt(): Promise<void>
    setConfig(config: Record<string, unknown>): Promise<void>
    close(): void
}

/** 通道对 SDK 的唯一依赖：建会话即触发 SDK 加载，因此返回 Promise */
export interface CodebuddyClient {
    createSession(options: SessionOptions): Promise<CodebuddySession>
    resumeSession(sessionId: string, options: SessionOptions): Promise<CodebuddySession>
}

/** 默认实现：直接转给 SDK，不做任何额外处理 */
export const sdkCodebuddyClient: CodebuddyClient = {
    createSession: async (options: SessionOptions): Promise<CodebuddySession> => {
        const sdk = await loadAgentSdk()
        return sdk.unstable_v2_createSession(options)
    },
    resumeSession: async (sessionId: string, options: SessionOptions): Promise<CodebuddySession> => {
        const sdk = await loadAgentSdk()
        return sdk.unstable_v2_resumeSession(sessionId, options)
    },
}
