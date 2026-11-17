/**
 * AI 对话页面的视图派生：视图阶段（idle / sending / streaming）、可写范围与用量文案，
 * 以及把会话快照、运行时与写作状态汇总成页面可直接渲染的展示值。
 * 复用约定：会话、运行时与写作状态类型取 @shared/types/aiChat，用量口径取 @shared/utils/format；
 * 阶段与展示汇总集中在展示层，会话 hook 转出阶段保持既有引用路径，避免展示层反向依赖状态机模块。
 * 关键约束：本层只读快照与运行时，不发请求、不写状态；作品标题为空时才兜底为通道名，
 * 缺作品不能影响用量徽标的承载行。
 */
import type { AiMessage, AiRuntimeInfo, AiSessionSnapshot, AiWriteState } from '@shared/types/aiChat'
import { formatTokens } from '@shared/utils/format'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
export type Phase = 'idle' | 'sending' | 'streaming'

/** 用量行文案：运行时未就绪时给出读取提示，避免闪出 0 */
export function toUsageText(runtime: AiRuntimeInfo | null): string {
    return runtime === null ? '正在读取配置…' : `今日 ${formatTokens(runtime.usedTokensToday)} tokens`
}

/** 可写范围：只认当前编辑器文档，未打开文档即不可发送（写作范围固定为当前文档） */
export function resolveWritableScope(writeState: AiWriteState | null): boolean {
    return writeState?.target !== null && writeState?.target !== undefined
}

/** 会话标题兜底：会话快照尚未就绪时占位，避免标题区随加载闪空 */
const FALLBACK_TITLE = 'AI 对话'

/** 摘要行通道名：无作品或作品标题未就绪时作为标题徽标兜底，保证用量徽标仍有承载行 */
const FALLBACK_CHANNEL_LABEL = 'CodeBuddy'

/** 空消息列表：会话快照未就绪时复用同一份引用，避免每次渲染新建数组 */
const EMPTY_MESSAGES: AiMessage[] = []

/** 对话页视图入参：只取决定展示的四个来源，模型与菜单数据由模型控制 hook 自行派生 */
export interface AiChatViewInput {
    session: AiSessionSnapshot | null
    runtime: AiRuntimeInfo | null
    writeState: AiWriteState | null
    projectTitle: string | null
}

/** 对话页视图：渲染所需的全部展示值，纯派生、不含任何交互 */
export interface AiChatView {
    messages: AiMessage[]
    /** 末条消息 id：作为消息流的滚动锚点，流式增长时保持贴底 */
    lastMessageId: string | undefined
    hasApiKey: boolean
    /** 当前是否有可写入的文档：写作范围固定为当前文档，没有目标即不可发送 */
    hasWritableScope: boolean
    title: string
    projectLabel: string
    usageText: string
}

/**
 * 汇总对话页的展示值：消息与滚动锚点、密钥就绪、可写范围、会话标题与用量文案。
 * 关键约束：作品标题为空时才兜底为通道名，缺作品不能影响用量徽标的承载行；
 * 本函数只读快照与运行时，不发请求、不写状态，页面据此可整段替换而不触碰交互逻辑。
 */
export function resolveAiChatView({ session, runtime, writeState, projectTitle }: AiChatViewInput): AiChatView {
    const messages = session?.messages ?? EMPTY_MESSAGES
    return {
        messages,
        lastMessageId: messages[messages.length - 1]?.id,
        hasApiKey: runtime?.hasApiKey === true,
        hasWritableScope: resolveWritableScope(writeState),
        title: session?.conversation.title ?? FALLBACK_TITLE,
        projectLabel: projectTitle !== null && projectTitle.length > 0 ? projectTitle : FALLBACK_CHANNEL_LABEL,
        usageText: toUsageText(runtime),
    }
}
