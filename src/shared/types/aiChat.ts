/**
 * AI 对话数据契约：宿主 ai/* 协议的请求与返回结构（设计源：docs/modules/ai-chat.md 第 7.2 节）。
 * 使用方：Webview AI 对话页（src/webview/ai-chat.tsx）与宿主侧 AiChatViewProvider / AiChatService。
 * 约束：字段由宿主归一化后填充，前端只负责展示，不承担解析与拼装。
 */

/** 会话模式：write 为写作改稿、chat 为侧栏问答；首版仅落地 chat */
export type AiConversationMode = 'write' | 'chat'

/** 消息角色 */
export type AiMessageRole = 'user' | 'assistant' | 'system'

/** 对话上下文引用类型：file 为整篇文档，selection 为行范围 */
export type AiContextRefKind = 'file' | 'selection'

/**
 * 对话上下文引用的展示契约：宿主生成，Webview 只消费。
 * 约束：不含绝对路径（宿主内部保留），前端删除引用时只回传 id，不得据 label 访问文件。
 */
export interface AiContextRef {
    /** 宿主生成的引用 id */
    id: string
    kind: AiContextRefKind
    /** 展示标签：notes/ch01.md:11-19（整篇为 notes/ch01.md） */
    label: string
    /** 展示路径：工作区相对路径；未命名文档为文件名 */
    displayPath: string
    /** 行范围（1-based，含首尾）；整篇引用为 null */
    startLine: number | null
    endLine: number | null
    /** 注入前预估字符数 */
    charCount: number
    /** 是否因超出单条上限而被截断 */
    isTruncated: boolean
}

/** 消息状态：与 ai-chat.md 第 4.2 节对话状态机一致 */
export type AiMessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'

/** 会话 */
export interface AiConversation {
    id: string
    title: string
    mode: AiConversationMode
    filePath: string | null
    model: string
    createdAt: string
    updatedAt: string
}

/** 消息 */
export interface AiMessage {
    id: string
    conversationId: string
    role: AiMessageRole
    content: string
    /** DeepSeek 思维链，可为空 */
    reasoning: string | null
    status: AiMessageStatus
    finishReason: string | null
    error: string | null
    /** 该条消息发送时携带的上下文引用（用于历史回显，正文不含引用原文） */
    refs: AiContextRef[]
    createdAt: string
}

/** 会话快照：视图加载与新建会话时返回 */
export interface AiSessionSnapshot {
    conversation: AiConversation
    messages: AiMessage[]
    /** 待发送的上下文引用（「添加到宅对话」的累积结果） */
    contexts: AiContextRef[]
}

/** 运行时信息：密钥状态与默认参数，用于页面引导与参数展示 */
export interface AiRuntimeInfo {
    /** 是否已在系统密钥库中配置 DeepSeek API Key */
    hasApiKey: boolean
    /** 脱敏后的 Key（仅末 4 位） */
    maskedApiKey: string
    model: string
    temperature: number
    maxContextTokens: number
    dailyTokenBudget: number
    /** 当日已消耗 token（预算护栏展示） */
    usedTokensToday: number
}

/** ai/send 的返回：流式增量随后经 stream 消息推送 */
export interface AiSendResult {
    conversationId: string
    /** 用户消息（已落库） */
    userMessage: AiMessage
    /** 待流式填充的助手消息 */
    assistantMessage: AiMessage
    /** 发送时读取失败（文件被删/不可读）而跳过的引用标签 */
    skippedContexts: string[]
}
