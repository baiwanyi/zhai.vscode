/**
 * AI 对话数据契约：宿主 ai/* 协议的请求与返回结构（设计源：docs/modules/ai-chat.md 第 7.2 节）。
 * 使用方：Webview 工作流 AI 对话页（src/webview/workflow/）与宿主侧 AiChatViewProvider / AiChatService。
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

/** 历史对话列表项：只含会话元信息，不含消息正文（面板历史浮层用） */
export interface AiConversationSummary {
    id: string
    title: string
    /** 最后活跃时间（ISO），前端展示为相对时间 */
    updatedAt: string
}

/** 消息 */
export interface AiMessage {
    id: string
    conversationId: string
    role: AiMessageRole
    content: string
    /** 思维链，可为空 */
    reasoning: string | null
    status: AiMessageStatus
    finishReason: string | null
    error: string | null
    /** 该条消息发送时携带的上下文引用（用于历史回显，正文不含引用原文） */
    refs: AiContextRef[]
    createdAt: string
}

/** 输入草稿：未发送的正文与已选命令，视图重建后由宿主带回 */
export interface AiChatDraft {
    input: string
    /** 已选写作命令 id；恢复时由前端按命令表收窄 */
    commandId: string | null
}

/** 会话快照：视图加载与新建会话时返回 */
export interface AiSessionSnapshot {
    conversation: AiConversation
    messages: AiMessage[]
    /** 待发送的上下文引用（「添加到宅对话」的累积结果） */
    contexts: AiContextRef[]
    /** 未发送的输入草稿：侧边栏切换导致视图重建后用于恢复输入框与命令 */
    draft: AiChatDraft
}

/** 写回作用域：selection 为编辑器选区，document 为整篇文档 */
export type AiWriteScope = 'selection' | 'document'

/**
 * 写回目标快照（下发前端用于提示与发送前置判断）。
 * 约束：不含绝对路径与原文，宿主内部另存 uri / version / range。
 */
export interface AiWriteTarget {
    scope: AiWriteScope
    /** 工作区相对路径；未命名文档为文件名 */
    displayPath: string
    /** 起止行（1-based，含首尾；整篇为首行到末行） */
    startLine: number
    endLine: number
    charCount: number
    /** 文档存在未保存修改 */
    isDirty: boolean
}

/** 写回状态：实时目标 + 可写回与已写回的消息 id */
export interface AiWriteState {
    target: AiWriteTarget | null
    /** 每条可写回消息对应的快照作用域：整篇时前端在写入前二次确认 */
    appliableScopes: Record<string, AiWriteScope>
    appliableMessageIds: string[]
    appliedMessageIds: string[]
}

/** 写回结果：reason 为 applied 时表示此前已写过，未重复写入 */
export interface AiApplyResult {
    applied: boolean
    label: string
    reason?: 'applied'
}

/** AI 通道标识：当前仅 CodeBuddy 一条通道 */
export type AiProviderId = 'codebuddy'

/** 运行时信息：通道、就绪状态与默认参数，用于页面引导与参数展示 */
export interface AiRuntimeInfo {
    /** 当前生效的通道 */
    provider: AiProviderId
    /** 通道站点展示名，用于登录引导说明 */
    providerSite?: string
    /** 通道是否就绪（登录态交由请求阶段判定，此值恒为 true） */
    hasApiKey: boolean
    /** 当前站点是否已确认完成登录（本插件内登录成功，或生成请求已走通一次） */
    loggedIn: boolean
    /** 已登录账号名；确认可用但未拿到账号名时为 null */
    loggedInUser: string | null
    model: string
    /** 当前模型的展示名：取自激活时预热的清单，未命中或清单为空时为空串（前端退回展示 id） */
    modelName: string
    maxContextTokens: number
    dailyTokenBudget: number
    /** 当日已消耗 token（预算护栏展示） */
    usedTokensToday: number
}

/** 单个可选模型 */
export interface AiModelOption {
    /** CLI 认可的模型 id，可直接交给 --model */
    modelId: string
    /** 展示名 */
    name: string
    /** 平台下发的额度倍率原文（如 "x0.51 credits"）；自定义模型未上报时为 null */
    credits: string | null
    /** 解析后的额度倍率（每次调用消耗的 credits 系数），无法解析时为 null */
    creditRate: number | null
    /** 是否为用户自定义模型：菜单据此拆分为「内置模型」「自定义模型」两组 */
    custom: boolean
}

/** 模型菜单数据：当前选择 + 账号可用清单（current 为空表示使用 CLI 默认模型） */
export interface AiModelChoices {
    current: string
    options: AiModelOption[]
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
