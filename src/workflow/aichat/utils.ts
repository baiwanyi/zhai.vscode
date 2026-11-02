/**
 * AI 对话展示层纯函数与视图类型：引用体积的紧凑折算、路径末段提取、会话快照的不可变消息替换、
 * 写作命令模板的发送拼装与回放拆分、工具名的动作文案，以及用量文案与可发送条件等派生计算。
 * 零依赖、无副作用，可被页面主组件与各子组件自由复用；token 折算与错误文案统一取 @shared/utils 的 format 与 error。
 * 视图阶段 Phase 一并定义在此，供会话 hook 与输入卡片共用，避免展示层反向依赖状态机模块。
 * 关键约束：命令模板只在发送瞬间拼接、在展示时按最长前缀剥离，输入框与消息气泡均不出现 instruction 全文；
 * 复制文本带上命令名与 `@zhai\` 写法的引用，剪贴板内容与气泡里看到的一致且可直接粘回输入框；
 * 工具名表只做展示映射，未知工具原样透出，不得据此推断权限。
 */
import type {
    AiContextRef,
    AiMessage,
    AiRuntimeInfo,
    AiSessionSnapshot,
    AiStep,
    AiWriteState,
} from '@shared/types/aiChat'
import { formatTokens } from '@shared/utils/format'
import { readStorageRootPath, replaceStorageRootPaths, toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import { AI_COMMAND_PREFIXES } from './constants'
import type { AiCommand } from './constants'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
export type Phase = 'idle' | 'sending' | 'streaming'

/** 引用体积描述：过千折算 k，被截断时追加标注 */
export function describeContext(ref: AiContextRef): string {
    const size = ref.charCount >= 1000 ? `${(ref.charCount / 1000).toFixed(1)}k 字` : `${ref.charCount} 字`
    return ref.isTruncated ? `${size} · 已截断` : size
}

/** 工具名展示表：模型返回英文工具名，界面给出中文动作 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
    Read: '读取文件',
    Glob: '查找文件',
    Grep: '检索内容',
    LS: '浏览目录',
    Edit: '修改文件',
    Write: '写入文件',
    MultiEdit: '批量修改',
    NotebookEdit: '修改笔记',
    AskUserQuestion: '向你提问',
}

/** 工具动作文案：进度行与审批弹窗共用，未知工具原样透出便于排查 */
export function describeTool(name: string): string {
    return TOOL_LABELS[name] ?? name
}

/**
 * 多选答案的分隔符：SDK 的 answers 是「问题原文 → 字符串」的映射，多选只能合并成一个值。
 * 关键约束：弹窗与流内问卷共用同一常量，两处口径不一致会让模型收到两种格式的答案。
 */
export const ANSWER_SEPARATOR = '、'

/** 步骤行标题：动作 + 对象；未知工具原样透出，便于排查 CLI 新增的能力 */
export function describeStep(step: AiStep): string {
    const action = describeTool(step.name)
    return step.detail === null || step.detail.length === 0 ? action : `${action} ${step.detail}`
}

/** 步骤耗时：不足一秒按毫秒展示；未知或非正数返回 null，不显示没有信息量的「0 秒」 */
export function formatStepDuration(elapsedMs: number | null): string | null {
    if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
        return null
    }
    return elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`
}

/**
 * 合并一条步骤快照：同 id 覆盖原位置，新 id 追加到末尾。
 * 关键约束：覆盖必须保序 —— 后到的状态更新不应把已完成的步骤跳到列表末尾。
 */
export function upsertStep(steps: AiStep[], incoming: AiStep): AiStep[] {
    const index = steps.findIndex((step) => step.id === incoming.id)
    if (index < 0) {
        return [...steps, incoming]
    }
    const next = [...steps]
    next[index] = incoming
    return next
}

/** 路径末段：兼容正反斜杠，空值原样返回；完整路径由调用方放进悬浮提示 */
export function toFileName(path: string): string {
    const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0)
    return segments[segments.length - 1] ?? path
}

/** 引用文件名：复用路径末段规则，保证引用芯片与审批目标的口径一致 */
export function toContextFileName(ref: AiContextRef): string {
    return toFileName(ref.displayPath)
}

/** 连续生成意图关键词：一次要写多章或整卷时，需要先取得一次「白名单内直接写入」授权 */
const CONTINUOUS_INTENT_KEYWORDS: readonly string[] = [
    '连续',
    '批量',
    '整卷',
    '多章',
    '全部章节',
    '所有章节',
    '逐章',
    '一口气',
    '接着写',
    '续写',
    '往下写',
    '自动生成',
]

/**
 * 粗筛「连续生成」意图：命中即先弹一次授权框，避免每写一个文件都要确认。
 * 关键约束：只用于提示层，误判最多让用户多点一次确认，不放宽任何权限边界。
 */
export function wantsContinuousGeneration(text: string): boolean {
    return CONTINUOUS_INTENT_KEYWORDS.some((keyword) => text.includes(keyword))
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

/** 用量行文案：运行时未就绪时给出读取提示，避免闪出 0 */
export function toUsageText(runtime: AiRuntimeInfo | null): string {
    return runtime === null ? '正在读取配置…' : `今日 ${formatTokens(runtime.usedTokensToday)} tokens`
}

/** 可写范围：编辑器目标或作品目录任一存在即可发送，连续生成章节不依赖选区 */
export function resolveWritableScope(projectDir: string | null, writeState: AiWriteState | null): boolean {
    const hasWriteTarget = writeState?.target !== null && writeState?.target !== undefined
    return hasWriteTarget || (projectDir !== null && projectDir.length > 0)
}

/** 可发送判定入参：密钥、阶段、命令与正文、写入范围共同决定能否发送 */
export interface SendGateInput {
    hasApiKey: boolean
    phase: Phase
    /** 已选命令：有命令时正文由指令模板提供，空输入也可发送 */
    command: AiCommand | null
    input: string
    hasWritableScope: boolean
}

/** 可发送判定：生成中、无密钥、无内容或无写入范围时一律禁止 */
export function resolveSendGate({ hasApiKey, phase, command, input, hasWritableScope }: SendGateInput): boolean {
    const hasContent = command !== null || input.trim().length > 0
    return hasApiKey && phase === 'idle' && hasContent && hasWritableScope
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

/** 剪贴板里的引用写法：`@zhai\...` 加行范围，与输入框可识别的令牌同构，粘回去即可还原成芯片 */
function toClipboardRef(ref: AiContextRef): string {
    const display = toZhaiDisplayPath(ref.displayPath)
    if (ref.startLine === null || /:\d+(?:-\d+)?$/u.test(display)) {
        return display
    }
    return ref.endLine === null || ref.endLine === ref.startLine
        ? `${display}:${String(ref.startLine)}`
        : `${display}:${String(ref.startLine)}-${String(ref.endLine)}`
}

/**
 * 消息的复制文本：命令名 + `@zhai\` 写法的引用 + 正文，正文里存储根下的绝对路径同样折算。
 * 关键约束：只复制用户可见的信息，指令模板全文不进剪贴板；没有徽章时等同于正文；
 * 路径统一成 `@zhai` 形式，粘贴回输入框时由宿主还原为引用芯片。
 */
export function toMessageCopyText(message: AiMessage): string {
    const { command, body } = splitCommandContent(message.content)
    const badges = [...(command === null ? [] : [command.title]), ...message.refs.map(toClipboardRef)]
    const text = replaceStorageRootPaths(body, readStorageRootPath())
    return [badges.join(' '), text].filter((part) => part.length > 0).join('\n')
}
