/**
 * 复制反馈：把「写剪贴板 → 成功切对勾 → 定时复位」的交互收成一处，供消息气泡与统计工具栏共用。
 * 复用约定：写入走 @shared/utils/clipboard（失败返回 false 而不抛错），失败提示统一用 sonner。
 * 关键约束：只有复制成功才切成功态，失败不谎报；定时器随卸载与状态变化清理，避免复位落到已卸载组件上。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { copyToClipboard } from '@shared/utils/clipboard'

/** 复制成功图标停留时长：够看清，又不至于一直挂在勾上 */
const DEFAULT_RESET_MS = 2000

/** 复制反馈对外暴露的状态与操作 */
export interface CopyFeedbackState {
    isCopied: boolean
    /** 复制文本：成功切成功态，失败只提示不切态 */
    copy: (text: string) => Promise<void>
}

export function useCopyFeedback(resetMs: number = DEFAULT_RESET_MS): CopyFeedbackState {
    const [isCopied, setIsCopied] = useState(false)

    useEffect(() => {
        if (!isCopied) {
            return
        }
        const timer = setTimeout((): void => {
            setIsCopied(false)
        }, resetMs)
        return (): void => {
            clearTimeout(timer)
        }
    }, [isCopied, resetMs])

    const copy = useCallback(async (text: string): Promise<void> => {
        const isSuccess = await copyToClipboard(text)
        if (!isSuccess) {
            toast.error('复制失败，请手动选中后复制')
            return
        }
        setIsCopied(true)
    }, [])

    return { isCopied, copy }
}
