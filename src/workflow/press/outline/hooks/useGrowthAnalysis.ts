/**
 * 成长线识别：把作品目录与当前成长表交给宿主 AI，取回成长节点建议。
 * 复用约定：请求取 @shared/utils/bridge，错误经 toastError、空结果经 toast.info 提示，形态与伏笔识别一致。
 * 关键约束：只由用户手动触发；同一时刻仅一次请求，卸载走 abort；
 * 建议只作候选、不直接写盘，调用方勾选后才追加到成长线。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { GrowthAnalyzeRequest, GrowthAnalyzeResult, GrowthPointSuggestion } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** AI 通道前端超时：略大于宿主 90s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 110_000

export interface GrowthAnalysisState {
    isAnalyzing: boolean
    suggestions: GrowthPointSuggestion[]
    analyze: (dirPath: string, points: GrowthAnalyzeRequest['points']) => Promise<GrowthPointSuggestion[]>
    abort: () => Promise<void>
    clear: () => void
}

export function useGrowthAnalysis(): GrowthAnalysisState {
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [suggestions, setSuggestions] = useState<GrowthPointSuggestion[]>([])
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const analyzingRef = useRef(false)

    const analyze = useCallback(
        async (dirPath: string, points: GrowthAnalyzeRequest['points']): Promise<GrowthPointSuggestion[]> => {
            if (analyzingRef.current) {
                return []
            }
            analyzingRef.current = true
            setIsAnalyzing(true)
            setSuggestions([])
            try {
                const payload: GrowthAnalyzeRequest = { dirPath, points }
                const result = await request<GrowthAnalyzeResult>(
                    'pressAi/aiAnalyzeGrowth',
                    payload,
                    AI_REQUEST_TIMEOUT_MS,
                )
                setSuggestions(result.points)
                if (result.points.length === 0) {
                    toast.info('未在正文中识别到明确的成长变化')
                }
                return result.points
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
            await request('pressAi/aiAnalyzeGrowth/abort')
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
