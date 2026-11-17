/**
 * AI 对话的发送门禁：密钥、阶段、正文与写入目标共同决定能否发送，
 * 并把输入卡片的生成态、锁定态、可发送、可增强与占位文案一次算齐。
 * 复用约定：阶段类型取同目录 view 的 Phase，页面层与输入卡片共用本层的判定，不各自实现一套口径。
 * 关键约束：可发送判定必须复用 resolveSendGate，避免页面层与输入卡片出现两种结论；
 * sending 也算生成中，否则等待期既不能发送也没有停止入口。
 */
import type { Phase } from './view'

/** 可发送判定入参：密钥、阶段、正文与写入目标共同决定能否发送 */
export interface SendGateInput {
    hasApiKey: boolean
    phase: Phase
    input: string
    hasWritableScope: boolean
}

/** 可发送判定：生成中、无密钥、无内容或无写入目标时一律禁止 */
export function resolveSendGate({ hasApiKey, phase, input, hasWritableScope }: SendGateInput): boolean {
    const hasContent = input.trim().length > 0
    return hasApiKey && phase === 'idle' && hasContent && hasWritableScope
}

/** 输入卡片门禁入参：阶段决定锁定态，其余三项参与可发送 / 可增强判定 */
export interface ComposerGateInput {
    phase: Phase
    hasApiKey: boolean
    hasWritableScope: boolean
    input: string
}

/** 输入卡片门禁：生成态、锁定态、可发送、可增强与占位文案一次算齐 */
export interface ComposerGate {
    /** 生成中：sending 也算，否则等待期既不能发送也没有停止入口 */
    isGenerating: boolean
    /** 输入区与外层控件统一锁定：生成中即锁定 */
    isLocked: boolean
    canSend: boolean
    canEnhance: boolean
    placeholder: string
}

/**
 * 输入卡片的五个门禁值：把「sending 也算生成中」这类规则从组件注释搬进纯函数。
 * 关键约束：可发送判定必须复用 resolveSendGate，避免页面层与输入卡片出现两套口径。
 */
export function resolveComposerGate({ phase, hasApiKey, hasWritableScope, input }: ComposerGateInput): ComposerGate {
    const isGenerating = phase !== 'idle'
    return {
        isGenerating,
        isLocked: isGenerating,
        canSend: resolveSendGate({ hasApiKey, phase, input, hasWritableScope }),
        canEnhance: input.trim().length > 0,
        placeholder: '提问或输入指令…',
    }
}
