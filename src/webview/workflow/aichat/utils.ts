/**
 * AI 对话展示层纯函数：token 数与引用字数的紧凑折算、未知错误的文本收窄、会话快照的不可变消息替换、
 * 宿主 state 广播载荷的收窄、增强提示词的规则化重写、写作命令模板的发送拼装与回放拆分。
 * 零依赖、无副作用，可被页面主组件与各子组件自由复用；展示规则与 docs/modules/ai-chat.md 第 10 节一致。
 * 关键约束：相对时间格式化已上移至 src/webview/utils.ts 供各 Webview 共用；readAiStateKind 只信任收窄结果；
 * 命令模板只在发送瞬间拼接、在展示时按最长前缀剥离，输入框与消息气泡均不出现 instruction 全文。
 */
import type { AiContextRef, AiConversationMode, AiMessage, AiSessionSnapshot } from '@shared/types/aiChat'
import { AI_COMMAND_PREFIXES } from './constants'
import type { AiCommand } from './constants'

/** token 数量紧凑展示：过千折算 k，过百万折算 M */
export function formatTokens(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}k`
    }
    return String(value)
}

export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 引用体积描述：过千折算 k，被截断时追加标注 */
export function describeContext(ref: AiContextRef): string {
    const size = ref.charCount >= 1000 ? `${(ref.charCount / 1000).toFixed(1)}k 字` : `${ref.charCount} 字`
    return ref.isTruncated ? `${size} · 已截断` : size
}

/** 引用文件名：只取路径末段（兼容正反斜杠），完整路径由调用方放进悬浮提示 */
export function toContextFileName(ref: AiContextRef): string {
    const segments = ref.displayPath.split(/[\\/]/).filter((segment) => segment.length > 0)
    return segments[segments.length - 1] ?? ref.displayPath
}

/** 就地替换指定消息，保持其余引用不变 */
export function patchMessage(
    session: AiSessionSnapshot | null,
    messageId: string,
    patch: (message: AiMessage) => AiMessage,
): AiSessionSnapshot | null {
    if (!session) {
        return session
    }
    return {
        ...session,
        messages: session.messages.map((item) => (item.id === messageId ? patch(item) : item)),
    }
}

/** 收窄宿主 state 广播的载荷：识别 ai 通道的三类通知 */
export function readAiStateKind(payload: unknown): 'runtime' | 'context' | 'writeTarget' | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const kind = (payload as { kind?: unknown }).kind
    return kind === 'runtime' || kind === 'context' || kind === 'writeTarget' ? kind : null
}

/** 增强提示词的固定标题，同时作为「已增强」判定标记 */
const ENHANCE_MARK = '【任务】'

/**
 * 规则化增强提示词：把用户输入补齐为目标、要求与输出格式三段，不调用模型。
 * 写作模式要求只输出可直接替换原文的正文；对话模式强调结论先行与可直接落笔的表述。
 * 空输入返回空串，已增强（以 ENHANCE_MARK 开头）的输入原样返回，避免反复叠加。
 */
export function enhancePrompt(text: string, mode: AiConversationMode): string {
    const body = text.trim()
    if (body.length === 0) {
        return ''
    }
    if (body.startsWith(ENHANCE_MARK)) {
        return text
    }
    const requirement =
        mode === 'write'
            ? '只输出可直接替换原文的正文，不要解释，不要加引号或代码块。'
            : '结论先行、表述简洁，涉及写作建议时给出可直接落笔的句子。'
    return [
        ENHANCE_MARK,
        body,
        '',
        '【要求】',
        `1. ${requirement}`,
        '2. 保持原有事实与信息，不虚构未提供的内容。',
        '3. 信息不足时先指出缺少什么，再给出可执行的部分。',
    ].join('\n')
}

/**
 * 命令发送拼装：指令模板在前、用户补充在后，二者以空行分隔；无补充时只发指令。
 * 拼装发生在发送瞬间，输入框始终只保存用户可见文本，避免提示词全文占据编辑区。
 */
export function composeCommandContent(command: AiCommand, body: string): string {
    const extra = body.trim()
    return extra.length > 0 ? `${command.instruction}\n\n${extra}` : command.instruction
}

/**
 * 消息回显拆分：按最长指令模板做前缀匹配，命中时返回命令与补充文本。
 * 历史消息重载后仍能以徽章回显；未命中时原样返回，不改变既有渲染结果。
 */
export function splitCommandContent(content: string): { command: AiCommand | null; body: string } {
    const normalized = content.trim()
    for (const command of AI_COMMAND_PREFIXES) {
        if (!normalized.startsWith(command.instruction)) {
            continue
        }
        return { command, body: normalized.slice(command.instruction.length).trim() }
    }
    return { command: null, body: content }
}
