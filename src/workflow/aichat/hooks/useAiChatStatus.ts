/**
 * AI 对话操作反馈出口：只承担操作类失败（发送、审批回包、增强提示词等）的 sonner 提示。
 * 生成过程中的错误随消息落库，由消息视图的 Alert 内联呈现，不经这里重复弹窗。
 * 独立成 hook 以避免会话 / 上下文 / 运行时 / 历史等 hook 之间的状态循环依赖。
 * 关键约束：入参为 null 表示「不清空任何提示」，不产生弹窗；上报函数引用恒定，
 * 供下游 hook 作为 effect 依赖使用（否则会反复触发会话重载）。
 */
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

/** 反馈出口：只保留错误上报，展示交给 sonner */
export interface AiChatStatus {
    /** 上报错误：非空即弹错误提示，null 表示无错误（不弹窗） */
    setError: (error: string | null) => void
}

export function useAiChatStatus(): AiChatStatus {
    const setError = useCallback((error: string | null): void => {
        if (error === null || error.length === 0) {
            return
        }
        toast.error(error)
    }, [])

    return useMemo(() => ({ setError }), [setError])
}
