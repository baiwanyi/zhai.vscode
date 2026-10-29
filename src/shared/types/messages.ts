/**
 * Webview 与扩展宿主之间的统一消息协议。
 * 设计源：docs/modules/common.md 第 7.3 节，请求-响应带 reqId 以支持并发匹配、超时与错误定位。
 */
export interface RequestMessage {
    type: 'request'
    reqId: string
    /** 协议方法名，如 'search/query'、'index/status' */
    method: string
    payload?: unknown
}

export interface ResponseMessage {
    type: 'response'
    reqId: string
    ok: boolean
    payload?: unknown
    error?: {
        code: string
        message: string
    }
}

/** 流末携带的用量：通道未回传时该字段整体缺省，前端此时不得臆造 token 数 */
export interface StreamUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

/** 宿主 → Webview：流式增量（AI 输出、索引进度等） */
export interface StreamMessage {
    type: 'stream'
    reqId: string
    delta: string
    done: boolean
    /** 增量所属通道，缺省为正文；reasoning 为模型思维链 */
    channel?: 'content' | 'reasoning'
    /** 结束时（done 为 true）的终态，供前端落定消息状态 */
    status?: 'completed' | 'failed' | 'cancelled'
    /** 结束时回传宿主侧完整正文，用于校正前端逐字累积结果 */
    content?: string
    error?: string
    /** 结束时回传的本轮用量，供消息底部工具栏展示 */
    usage?: StreamUsage
    /** 本轮耗时（毫秒，墙钟：含上下文准备与首字等待），未知时缺省 */
    durationMs?: number
    /** usage 是否为按回复字数估算：估算值展示时必须与真实用量区分 */
    tokensEstimated?: boolean
    /** 本轮真实积分（来自 CLI 会话记录）：缺省或 null 均为未知 */
    credits?: number | null
    /** 本轮结束后的会话上下文占用：缺省表示通道未回传，前端保留原值 */
    contextUsage?: {
        usedTokens: number
        windowTokens: number
    }
    /**
     * 会话内的上下文压缩事件：compacting 表示正在压缩，compacted 表示压缩完成。
     * 关键约束：只用于提示，不改动正文与用量；与 done 无关，可单独下发。
     */
    notice?: 'compacting' | 'compacted'
}

/** 操作反馈级别：与 sonner 的四个入口一一对应 */
export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

/** 宿主 → Webview 的操作反馈载荷：由前端统一用 sonner 呈现 */
export interface ToastPayload {
    level: ToastLevel
    message: string
}

/**
 * 宿主 → Webview：状态广播（索引就绪、配置变更、窗口聚焦、活跃笔记切换、工作流场景切换、
 * 作品导入进度、语义归纳进度、操作反馈）。
 * press 通道承载当前文档所属的作品目录，载荷形如 PressActiveState；
 * press-import 通道承载导入任务的进度与终态，载荷形如 PressImportProgress；
 * press-semantic 通道承载 AI 语义归纳的进度与终态，载荷形如 PressSemanticProgress；
 * imagegen 通道承载出图阶段（准备 / 已调用工具），载荷形如 ImageGenerateProgress；
 * proofread 通道承载 AI 校对的分批进度，载荷形如 ProofreadAiProgress；
 * todo 通道承载待办目录的外部变更（无载荷，收到即刷新）；
 * toast 通道承载宿主的操作反馈，载荷形如 ToastPayload。
 */
export interface StateMessage {
    type: 'state'
    channel:
        | 'index'
        | 'config'
        | 'ai'
        | 'note'
        | 'press'
        | 'workflow'
        | 'press-import'
        | 'press-semantic'
        | 'imagegen'
        | 'proofread'
        | 'todo'
        | 'toast'
    payload: unknown
}

/** 收窄 toast 广播载荷：Webview 侧收到的数据不可信，级别与文案逐字段校验后再展示 */
export function isToastPayload(payload: unknown): payload is ToastPayload {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const { level, message } = payload as { level?: unknown; message?: unknown }
    if (typeof message !== 'string' || message.length === 0) {
        return false
    }
    return level === 'info' || level === 'success' || level === 'warning' || level === 'error'
}

export type HostToWebviewMessage = ResponseMessage | StreamMessage | StateMessage

export type WebviewToHostMessage = RequestMessage

/**
 * Webview → 宿主的请求方法名：与扩展侧 handler 注册表一一对应。
 * 收窄成字面量联合后，拼错方法名在编译期就会失败，而不是等到运行时收到「未知方法」。
 * 新增方法时两侧同时维护（本表 + src/modules 的注册表），不放宽为 string。
 */
export type HostMethodName =
    | 'ai/abort'
    | 'ai/applyHunks'
    | 'ai/applyWrite'
    | 'ai/context'
    | 'ai/context/clear'
    | 'ai/context/remove'
    | 'ai/deleteSession'
    | 'ai/draft'
    | 'ai/enhancePrompt'
    | 'ai/mention/add'
    | 'ai/mention/search'
    | 'ai/models'
    | 'ai/reference/add'
    | 'ai/reference/openDir'
    | 'ai/reference/search'
    | 'ai/newSession'
    | 'ai/runtime'
    | 'ai/selectContextWindow'
    | 'ai/selectEffort'
    | 'ai/selectModel'
    | 'ai/send'
    | 'ai/session'
    | 'ai/sessions'
    | 'ai/setMode'
    | 'ai/switchSession'
    | 'ai/usage'
    | 'ai/usage/prompt'
    | 'ai/writeDiff'
    | 'ai/writeState'
    | 'dashboard/stats'
    | 'host/command'
    | 'host/openExternal'
    | 'index/rebuild'
    | 'media/copy'
    | 'media/delete'
    | 'media/deleteBatch'
    | 'media/detail'
    | 'media/insert'
    | 'media/list'
    | 'media/rescan'
    | 'media/setCover'
    | 'naming/abort'
    | 'naming/aiGenerate'
    | 'naming/catalog'
    | 'naming/favorite/toggle'
    | 'naming/favorites'
    | 'naming/generate'
    | 'naming/history'
    | 'naming/history/clear'
    | 'note/active'
    | 'note/create'
    | 'note/open'
    | 'note/pin'
    | 'press/active'
    | 'press/analyze'
    | 'press/apply'
    | 'press/create'
    | 'press/createChapter'
    | 'press/createVolume'
    | 'press/deleteChapter'
    | 'press/deleteProject'
    | 'press/deleteVolume'
    | 'press/detail'
    | 'press/extract/characters'
    | 'press/extract/outline'
    | 'press/extract/setting'
    | 'press/import/cancel'
    | 'press/import/pick'
    | 'press/import/start'
    | 'press/mergeChapterSummary'
    | 'press/moveChapter'
    | 'press/open'
    | 'press/openChapter'
    | 'press/projects'
    | 'press/renameVolume'
    | 'press/snapshot/chapter/capture'
    | 'press/snapshot/chapter/delete'
    | 'press/snapshot/chapter/list'
    | 'press/snapshot/chapter/restore'
    | 'press/snapshot/chapter/versions'
    | 'press/snapshot/create'
    | 'press/snapshot/delete'
    | 'press/snapshot/list'
    | 'press/snapshot/restore'
    | 'press/workspace'
    | 'pressAi/aiAppearance'
    | 'pressAi/aiAppearance/abort'
    | 'pressAi/aiSettingField'
    | 'pressAi/aiSettingField/abort'
    | 'pressAi/aiLoreDescription'
    | 'pressAi/aiLoreDescription/abort'
    | 'pressAi/deletePromptRule'
    | 'pressAi/deletePromptTag'
    | 'pressAi/enhanceImagePrompt'
    | 'pressAi/generateImage'
    | 'pressAi/generateImage/abort'
    | 'pressAi/getImageSettings'
    | 'pressAi/getPromptImageBase'
    | 'pressAi/listCover'
    | 'pressAi/listLoreGallery'
    | 'pressAi/listLoreImages'
    | 'pressAi/listPromptRules'
    | 'pressAi/listPromptTags'
    | 'pressAi/listPortraitGallery'
    | 'pressAi/listPortraits'
    | 'pressAi/openPromptRuleDir'
    | 'pressAi/openPromptTagDir'
    | 'pressAi/pickReferenceImage'
    | 'pressAi/readPromptRule'
    | 'pressAi/saveImageSettings'
    | 'pressAi/savePromptRule'
    | 'pressAi/savePromptTag'
    | 'pressAi/updatePromptRule'
    | 'pressAi/updatePromptTag'
    | 'proofread/ai'
    | 'proofread/ai/abort'
    | 'proofread/aiDetect'
    | 'proofread/aiDetect/cache'
    | 'proofread/aiDetect/consent'
    | 'proofread/aiDetect/state'
    | 'proofread/apply'
    | 'proofread/cache'
    | 'proofread/lexicon'
    | 'proofread/lexicon/open'
    | 'proofread/lexicon/read'
    | 'proofread/lexicon/save'
    | 'proofread/local'
    | 'proofread/reveal'
    | 'proofread/target'
    | 'todo/item/add'
    | 'todo/item/delete'
    | 'todo/item/toggle'
    | 'todo/list/create'
    | 'todo/list/delete'
    | 'todo/list/rename'
    | 'todo/lists'
    | 'todo/items'
    | 'workflow/open'
    | 'workflow/reset'
    | 'workflow/state'

/** 状态广播通道白名单：未知通道直接丢弃，避免订阅者按不可信的 channel 分支 */
function isStateChannel(value: unknown): value is StateMessage['channel'] {
    return (
        value === 'index' ||
        value === 'config' ||
        value === 'ai' ||
        value === 'note' ||
        value === 'press' ||
        value === 'workflow' ||
        value === 'press-import' ||
        value === 'press-semantic' ||
        value === 'imagegen' ||
        value === 'proofread' ||
        value === 'todo' ||
        value === 'toast'
    )
}

/**
 * 收窄流式增量：Webview 收到的数据不可信，逐字段校验后才交给订阅者。
 * delta 为空串是合法的（如仅 reasoning 增量），故只校验类型不校验长度。
 */
export function isStreamMessage(input: unknown): input is StreamMessage {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const { type, reqId, delta, done } = input as {
        type?: unknown
        reqId?: unknown
        delta?: unknown
        done?: unknown
    }
    return type === 'stream' && typeof reqId === 'string' && typeof delta === 'string' && typeof done === 'boolean'
}

/** 收窄状态广播：channel 必须在白名单内，payload 的具体形状由各通道自行再校验 */
export function isStateMessage(input: unknown): input is StateMessage {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const { type, channel } = input as { type?: unknown; channel?: unknown }
    return type === 'state' && isStateChannel(channel)
}

/** 收窄请求响应：ok 必须显式为布尔，缺失时视为畸形消息直接丢弃 */
export function isResponseMessage(input: unknown): input is ResponseMessage {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const { type, reqId, ok } = input as { type?: unknown; reqId?: unknown; ok?: unknown }
    return type === 'response' && typeof reqId === 'string' && typeof ok === 'boolean'
}

/** 判断是否为请求消息（类型收窄辅助） */
export function isRequestMessage(message: unknown): message is RequestMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'request' &&
        typeof (message as { reqId?: unknown }).reqId === 'string' &&
        typeof (message as { method?: unknown }).method === 'string'
    )
}
