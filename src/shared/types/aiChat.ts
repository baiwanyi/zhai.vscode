/**
 * AI 对话数据契约：宿主 ai/* 协议的请求与返回结构（设计源：docs/modules/ai-chat.md 第 7.2 节）。
 * 使用方：Webview 工作流 AI 对话页（src/workflow/）与宿主侧 AiChatViewProvider / AiChatService。
 * 约束：字段由宿主归一化后填充，前端只负责展示，不承担解析与拼装。
 */

/**
 * 会话形态：固定为写作执行（可读可写，由宿主按范围授权）。
 * 历史上有对话 / 写作两种模式，切换入口已移除，不再保留模式类型。
 */

/**
 * 写入授权范围：document 仅当前编辑栏文档，project 为整个作品目录。
 * 新建会话默认取 document，扩大授权必须由用户显式切换。
 * 关键约束：只对 write 模式生效，chat 模式恒为只读；project 需要会话已绑定作品目录；
 * 既无活动文档又无作品目录时写入根为空，发送会被拒绝。
 */
export type AiWriteGrant = 'document' | 'project'

/**
 * 写入审批：ask 逐次确认、auto 白名单内直接写入。
 * 关键约束：只是宿主侧守卫的策略位，不映射 SDK 的 permissionMode ——
 * 后者一旦切到 acceptEdits，编辑类工具由 CLI 直接放行，路径校验会被整体绕过；
 * 模式由本轮发送时的授权决定，不提供常驻开关。
 */
export type AiApprovalMode = 'ask' | 'auto'

/** 单个待回答的问题：结构对齐 SDK 的 AskUserQuestion 入参 */
export interface AiAskQuestion {
    /** 问题原文：同时作为回传答案的键 */
    question: string
    /** 短标签，展示为分组标题 */
    header: string
    options: { label: string; description: string }[]
    /** 是否允许多选 */
    multiSelect: boolean
}

/**
 * 待确认的工具调用：宿主推送给 Webview，用户在弹窗里决定后回传。
 * 关键约束：由宿主生成 id（与 SDK 的 toolUseID 一致），前端只回传这个 id；
 * editablePath 为写入类目标路径，当前前端不提供改写入口、原样回传，宿主收到后仍会重新校验。
 */
export interface AiPermissionRequest {
    id: string
    /** tool 为工具审批，question 为模型向用户提问 */
    kind: 'tool' | 'question'
    toolName: string
    /** 工具关键参数：写入类给路径，提问类给问题条数摘要 */
    detail: string
    /**
     * 风险说明：由宿主按工具语义下发的展示文案，前端只渲染，不自行推断工具后果。
     * 关键约束：新增审批类型必须显式给出，展示层不得回退到硬编码文案。
     */
    effect: string
    /** 写入类工具的目标路径：仅写入类提供，当前前端只原样回传、不提供改写入口 */
    editablePath: string | null
    /** 待回答的问题：kind 为 question 时至少一条 */
    questions: AiAskQuestion[]
    /**
     * 归属的助手消息 id：由审批桥补齐（通道层不感知消息），前端据此把提问卡片挂到对应气泡下。
     * 关键约束：缺省或 null 表示无法归属，前端必须退回弹窗 —— 挂不上消息的卡片会永远不可见。
     */
    messageId?: string | null
    /**
     * 提交截止时间（毫秒时间戳）：由审批桥按题量计算，前端据此提示剩余时间。
     * 关键约束：缺省表示宿主未给出期限，前端不得自行编造倒计时。
     */
    expiresAt?: number
}

/** 审批结果：allow 时带回用户可能改过的路径与答案 */
export interface AiPermissionDecision {
    allowed: boolean
    /** 用户改写后的目标路径：宿主重新校验后才采纳 */
    path?: string
    /** 问题答案：键为问题原文，值为选项 label */
    answers?: Record<string, string>
}

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

/** 步骤状态：pending 排队待执行、running 进行中、done 已完成、error 失败 */
export type AiStepStatus = 'pending' | 'running' | 'done' | 'error'

/**
 * 收窄一条执行步骤：宿主读库与 Webview 收流都会拿到不可信数据，
 * 缺 id 或工具名的整条丢弃，状态取白名单，其余字段按类型兜底。
 * 关键约束：未知状态按已完成处理 —— 历史脏数据不该让界面一直停在转圈状态。
 */
export function readAiStep(value: unknown): AiStep | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = typeof record.name === 'string' ? record.name : ''
    if (id.length === 0 || name.length === 0) {
        return null
    }
    return {
        id,
        kind: record.kind === 'task' ? 'task' : 'tool',
        name,
        detail: typeof record.detail === 'string' ? record.detail : null,
        status:
            record.status === 'pending' || record.status === 'running' || record.status === 'error'
                ? record.status
                : 'done',
        error: typeof record.error === 'string' ? record.error : null,
        parentId: typeof record.parentId === 'string' ? record.parentId : null,
        elapsedMs: typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs) ? record.elapsedMs : null,
    }
}

/** 步骤类型：tool 为一次工具调用，task 为子代理或后台任务 */
export type AiStepKind = 'tool' | 'task'

/**
 * 一条执行步骤：助手消息的「过程」载体，与正文、思维链并列。
 * 关键约束：detail 是脱敏后的展示值（路径只留末段、超长截断），宿主不得把完整入参写入该字段；
 * id 对工具是 tool_use_id、对任务是 task_id，同一条消息内保持唯一，前端据此增量覆盖。
 */
export interface AiStep {
    id: string
    kind: AiStepKind
    /** 原始工具名或任务类型（如 Read / Edit / Agent），展示层经 describeTool 映射中文 */
    name: string
    /** 关键入参摘要：文件名、命令或任务描述；无合适取值时为 null */
    detail: string | null
    status: AiStepStatus
    /** 失败原因：仅 status 为 error 时有值 */
    error: string | null
    /** 父步骤 id：子代理内部的工具调用挂到对应任务行下 */
    parentId: string | null
    /** 已耗时（毫秒）：未知为 null，不填 0 以免显示成「0 秒」 */
    elapsedMs: number | null
}

/** 会话 */
export interface AiConversation {
    id: string
    title: string
    /** 写入授权范围：据此决定工具白名单边界 */
    writeGrant: AiWriteGrant
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
    /** 执行步骤：工具调用与子任务的时间线；空数组表示本轮没有可展示的过程 */
    steps: AiStep[]
    status: AiMessageStatus
    finishReason: string | null
    error: string | null
    /** 该条消息发送时携带的上下文引用（用于历史回显，正文不含引用原文） */
    refs: AiContextRef[]
    /** 本轮消耗的总 token；0 表示未知（用户消息、历史数据或通道未回传） */
    totalTokens: number
    /** 本轮耗时（毫秒，墙钟）；0 表示未知 */
    durationMs: number
    /** totalTokens 是否为按回复字数估算：估算值不得当作真实成本展示 */
    tokensEstimated: boolean
    /** 本轮真实积分（来自 CLI 会话记录）；null 表示未知或未对账，不得回退成 0 */
    credits: number | null
    createdAt: string
}

/** 输入草稿：未发送的正文与已选命令，视图重建后由宿主带回 */
export interface AiChatDraft {
    input: string
    /** 已选写作命令 id；恢复时由前端按命令表收窄 */
    commandId: string | null
}

/**
 * 会话上下文占用：usedTokens 取最近一轮模型请求的输入量（含缓存读写与系统提示），
 * windowTokens 为该模型当前上下文档位；windowTokens 为 0 表示窗口未知，前端不得据此编造占比。
 */
export interface AiContextUsage {
    usedTokens: number
    windowTokens: number
}

/** 会话快照：视图加载与新建会话时返回 */
export interface AiSessionSnapshot {
    conversation: AiConversation
    messages: AiMessage[]
    /** 待发送的上下文引用（「添加到宅对话」的累积结果） */
    contexts: AiContextRef[]
    /** 未发送的输入草稿：侧边栏切换导致视图重建后用于恢复输入框与命令 */
    draft: AiChatDraft
    /** 上下文占用：尚未生成过的会话为 null */
    contextUsage: AiContextUsage | null
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

/** 写入状态：仅实时目标，用于发送前置判断与范围提示 */
export interface AiWriteState {
    target: AiWriteTarget | null
}

/** 提及候选类型：按索引路径前缀归类，仅用于展示分组 */
export type AiMentionKind = 'note' | 'chapter' | 'other'

/** 提及候选：path 为相对存储根的索引路径，添加时原样回传 */
export interface AiMentionCandidate {
    path: string
    title: string
    kind: AiMentionKind
}

/** 参考资料条目：检索结果与注入单位；file + startLine 由宿主重新解析校验 */
export interface AiReferenceEntry {
    /** 相对存储根的语料文件路径（reference/xxx.md） */
    file: string
    /** 分类：文件一级标题，缺省为文件名 */
    category: string
    /** 条目名：二级标题 */
    name: string
    /** 条目起始行（1 基，含标题行） */
    startLine: number
    /** 检索命中的正文片段，仅用于展示 */
    snippet: string
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
    /** 当前生效的上下文窗口（token）：优先取用户档位，未选择时取模型默认，0 表示未知 */
    contextWindowTokens: number
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
    /** 模型默认上下文档位（token），0 表示平台未下发 */
    contextWindowTokens: number
    /** 该模型支持的可选上下文档位（升序），空数组表示平台未下发 */
    contextWindowOptions: number[]
}

/** 推理强度：与 SDK 的 Effort 对齐，只开放常用四档（minimal / max 不开放） */
export type AiReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/** 推理强度展示名：菜单与宿主日志共用 */
export const AI_REASONING_EFFORT_LABELS: Readonly<Record<AiReasoningEffort, string>> = {
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '极高',
}

/** 推理强度白名单：菜单选项与宿主入参校验共用同一份 */
export const AI_REASONING_EFFORTS: readonly AiReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']

/** 推理强度收窄：非白名单值一律不通过 */
export function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
    return AI_REASONING_EFFORTS.some((item) => item === value)
}

/** 模型菜单数据：当前选择 + 账号可用清单（current 为空表示使用 CLI 默认模型） */
export interface AiModelChoices {
    current: string
    /** 当前上下文档位：0 表示跟随模型默认 */
    contextWindow: number
    /** 当前推理强度：null 表示跟随模型默认 */
    reasoningEffort: AiReasoningEffort | null
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
