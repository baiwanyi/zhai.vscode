/**
 * 伏笔位置识别：把作品目录与伏笔白名单交给宿主 AI，取回埋设/回收位置建议。
 * 复用约定：请求取 @shared/utils/bridge，错误经 toastError、空结果经 toast.info 提示。
 * 关键约束：只由用户手动触发；同一时刻仅一次请求，卸载走 abort；
 * 建议只作候选，不直接写盘，调用方勾选后才应用到伏笔引用。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ClueRefsAnalyzeRequest, ClueRefsAnalyzeResult, ClueRefSuggestion } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** AI 通道前端超时：略大于宿主 90s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 110_000

export interface ClueRefsAnalysisState {
    isAnalyzing: boolean
    suggestions: ClueRefSuggestion[]
    analyze: (dirPath: string, clues: ClueRefsAnalyzeRequest['clues']) => Promise<ClueRefSuggestion[]>
    abort: () => Promise<void>
    clear: () => void
}

export function useClueRefsAnalysis(): ClueRefsAnalysisState {
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [suggestions, setSuggestions] = useState<ClueRefSuggestion[]>([])
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const analyzingRef = useRef(false)

    const analyze = useCallback(
        async (dirPath: string, clues: ClueRefsAnalyzeRequest['clues']): Promise<ClueRefSuggestion[]> => {
            if (analyzingRef.current) {
                return []
            }
            analyzingRef.current = true
            setIsAnalyzing(true)
            setSuggestions([])
            try {
                const payload: ClueRefsAnalyzeRequest = { dirPath, clues }
                const result = await request<ClueRefsAnalyzeResult>(
                    'pressAi/aiAnalyzeClueRefs',
                    payload,
                    AI_REQUEST_TIMEOUT_MS,
                )
                setSuggestions(result.refs)
                if (result.refs.length === 0) {
                    toast.info('未在正文中识别到明确的伏笔位置')
                }
                return result.refs
            } catch (cause) {
                toastError(cause)
                return []
            } finally {
                analyzingRef.current = false
                setIsAnalyzing(false)
            }
        },
        [],
    )

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiAnalyzeClueRefs/abort')
        } catch {
            // 取消属于尽力而为：宿主没有在途请求或已结束时忽略错误
        }
    }, [])

    const clear = useCallback((): void => {
        setSuggestions([])
    }, [])

    // 对话框卸载时取消在途请求，避免结果无人接收却仍消耗配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isAnalyzing, suggestions, analyze, abort, clear }
}
