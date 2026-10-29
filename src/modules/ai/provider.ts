/**
 * AI 通道契约：抽象「把一组消息流式生成为文本」的能力，供会话服务、取名与外貌生成共用。
 * 复用约定：请求与增量类型保持稳定结构，调用方只依赖本接口，不感知具体实现；
 * 取消统一走 AbortSignal，由实现映射到底层中断手段（CodeBuddy 通道调 interrupt）。
 * 关键约束：实现自行从 SecretsService 读取凭证，不经调用方透传；实现不得持有跨请求状态，
 * 并发隔离交给调用方的 AbortController，避免多入口同时生成时互相串流。
 */

import type {
    AiApprovalMode,
    AiContextUsage,
    AiPermissionDecision,
    AiPermissionRequest,
    AiProviderId,
} from '@shared/types/aiChat'

/** 通道标识：与 webview 共用的类型来源为 shared/types/aiChat */
export type { AiProviderId } from '@shared/types/aiChat'

/** 对话消息：通道之间通用的最小字段集 */
export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** 单次生成的用量：服务端未返回时由调用方按字符数估算 */
export interface AiUsage {
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    totalTokens: number
}

/**
 * 请求标识与计费元数据：由通道从 SDK 的 result 消息解析，仅在流末块携带。
 * 关键约束：SDK 的 requestId / messageId 属实验性字段，缺失时为 null；costUsd 为 0 是有效值（订阅账号），
 * 不得当作「未知」，未知一律走 credits 为 null 的表达。
 */
export interface AiUsageMeta {
    /** 通道侧逻辑轮次标识 */
    requestId: string | null
    /** 通道侧单次生成标识 */
    messageId: string | null
    /** 服务端计价（美元） */
    costUsd: number
    /** 总耗时与模型侧耗时（毫秒） */
    durationMs: number
    durationApiMs: number
    cacheReadTokens: number
    cacheCreationTokens: number
}

/** 流式增量：正文与思维链分通道，用量与元数据仅在流末块携带 */
export interface AiStreamChunk {
    content: string
    reasoning: string
    usage?: AiUsage
    meta?: AiUsageMeta
    /**
     * usage 是否为「本轮单轮值」。
     * 关键约束：续接会话时通道底层的累计用量不能当本轮值，只有从单次请求用量（输入）与
     * 单次消息用量（输出）拼出的才是单轮；为 false 时上层不得据此记账。
     */
    isRoundUsage?: boolean
    /** 本轮上下文占用：通道拿不到模型请求的输入用量时缺省，由上层保留上一次的值 */
    context?: AiContextUsage
    /**
     * 上下文压缩事件：compacting 表示正在压缩，compacted 表示压缩完成。
     * 关键约束：旁路提示，不影响正文与用量；上层据此解释「占用为何突然下降」。
     */
    notice?: 'compacting' | 'compacted'
    /**
     * 工具活动：模型正在调用某个工具（读取章节、写入文件等）。
     * 关键约束：工具执行期间正文可能长时间无增量，上层据此重置空闲计时并向前端展示进度。
     */
    toolActivity?: string
}

/**
 * 工具权限策略：由会话服务按模式与写入范围构造，通道只按策略下发，不感知业务语义。
 * 关键约束：writeRoots 为空表示完全只读；roots 均为小写化的绝对路径，即白名单边界；
 * 策略缺省时通道按纯文本生成处理（禁用全部内置工具、单轮、临时目录）。
 */
export interface AiToolPolicy {
    /** 允许调用的内置工具名白名单 */
    tools: string[]
    /** 允许读取的目录根（绝对路径） */
    readRoots: string[]
    /** 允许写入的目录或文件根（绝对路径），空数组表示完全只读 */
    writeRoots: string[]
    /** 审批模式：ask 逐次确认写入、auto 白名单内自动放行、readonly 完全只读 */
    approval: AiApprovalMode
    /** 单次请求允许的最大轮次：多轮工具往返需要大于 1 */
    maxTurns: number
    /** CLI 工作目录：决定模型相对路径的落点 */
    cwd: string
}

/**
 * 审批往返能力：由调用方注入，通道在 canUseTool 中调用它把决定权交给用户。
 * 约定：实现方负责超时与取消收口，通道只等待一个结果，不感知交互细节。
 */
export interface AiPermissionChannel {
    request(request: AiPermissionRequest): Promise<AiPermissionDecision>
}

/** 流式生成请求：长度上限按通道能力可被忽略，但调用方始终传入 */
export interface AiStreamRequest {
    model: string
    maxTokens: number
    messages: AiChatMessage[]
    signal: AbortSignal
    /** 续接通道侧会话：传入后只把最后一条用户消息作为本轮输入，历史由通道维护 */
    sessionId?: string
    /** 通道建立或续接会话成功时回传会话号，供上层持久化 */
    onSessionId?: (sessionId: string) => void
    /** 工具权限策略：缺省即纯文本生成，不开放任何内置工具 */
    toolPolicy?: AiToolPolicy
    /** 审批通道：审批模式为 ask 时写入与提问都经它往返；缺省表示无交互能力 */
    permission?: AiPermissionChannel
    /**
     * 写入文本规范化：整文件写入前按文档类型补齐元信息，返回修正后的内容。
     * 约定：只对 Write 生效，Edit 的片段替换不经过它；缺省表示不改写入参。
     */
    normalizeWrite?: (filePath: string, content: string) => string
}

/** 通道就绪状态：未就绪时 reason 为可直接展示给用户的提示 */
export interface AiProviderStatus {
    ready: boolean
    reason?: string
}

/** 通道实现：每个实例对应一种接入方式，全扩展共用一个实例 */
export interface AiProvider {
    readonly id: AiProviderId
    /** 发送前检查凭据或登录态；实现不得在此发起生成请求 */
    checkReady(): Promise<AiProviderStatus>
    stream(request: AiStreamRequest): AsyncGenerator<AiStreamChunk>
}
