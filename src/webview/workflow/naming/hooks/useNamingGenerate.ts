/**
 * 取名生成：按通道向宿主提交条件——本地走 naming/generate（毫秒级），AI 走 naming/aiGenerate（长超时）。
 * 复用约定：请求经 webview 公共 bridge；AI 通道的超时略大于宿主侧 60s，保证宿主先给出超时错误。
 * 关键约束：生成中不接受重复提交；AI 通道支持取消（naming/abort）；空结果视为词素不足并给出可操作提示。
 */
import { useCallback, useState } from 'react'
import type { NamingCandidate, NamingGenerateResult, NamingRequest } from '@/shared/types/naming'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** AI 通道前端超时：略大于宿主 60s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 70_000

/** 生成 hook 的对外状态 */
export interface NamingGenerateState {
    items: NamingCandidate[]
    isGenerating: boolean
    error: string | null
    generate: (payload: NamingRequest) => Promise<void>
    abort: () => Promise<void>
}

export function useNamingGenerate(): NamingGenerateState {
    const [items, setItems] = useState<NamingCandidate[]>([])
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const generate = useCallback(async (payload: NamingRequest): Promise<void> => {
        setIsGenerating(true)
        setError(null)
        const isAi = payload.source === 'ai'
        try {
            const result = await request<NamingGenerateResult>(
                isAi ? 'naming/aiGenerate' : 'naming/generate',
                payload,
                isAi ? AI_REQUEST_TIMEOUT_MS : undefined,
            )
            setItems(result.items)
            if (result.items.length === 0) {
                setError('当前条件可用的词素不足，未能生成名字，请放宽条件后重试')
            }
        } catch (cause) {
            setError(toErrorText(cause))
        } finally {
            setIsGenerating(false)
        }
    }, [])

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('naming/abort')
        } catch {
            // 取消属于尽力而为：宿主无进行中请求或已结束时忽略错误
        }
    }, [])

    return { items, isGenerating, error, generate, abort }
}
