/**
 * 取名生成：按通道向宿主提交条件——本地走 naming/generate（毫秒级），AI 走 naming/aiGenerate（长超时），
 * 结果按分类缓存，切换分类时可复现之前生成的内容。
 * 复用约定：请求经 @shared/utils/bridge；AI 通道的超时略大于宿主侧 60s，保证宿主先给出超时错误。
 * 关键约束：生成中不接受重复提交；AI 通道支持取消（naming/abort）；结果按 payload.category 落缓存，
 * 避免异步返回时用户已切换分类导致结果串台；失败原因统一经 sonner 提示，不回传错误状态给组件渲染。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { NamingCandidate, NamingCategory, NamingGenerateResult, NamingRequest } from '@shared/types/naming'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** AI 通道前端超时：略大于宿主 60s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 70_000

/** 生成 hook 的对外状态 */
export interface NamingGenerateState {
    items: NamingCandidate[]
    isGenerating: boolean
    generate: (payload: NamingRequest) => Promise<void>
    abort: () => Promise<void>
    /** 某分类是否已有结果：切换分类时据此决定是否自动生成 */
    hasResult: (category: NamingCategory) => boolean
}

/**
 * @param category 当前展示的分类：结果按分类缓存，切回时直接读取
 */
export function useNamingGenerate(category: NamingCategory): NamingGenerateState {
    const [results, setResults] = useState<Partial<Record<NamingCategory, NamingCandidate[]>>>({})
    const [isGenerating, setIsGenerating] = useState(false)

    const generate = useCallback(async (payload: NamingRequest): Promise<void> => {
        setIsGenerating(true)
        const isAi = payload.source === 'ai'
        try {
            const result = await request<NamingGenerateResult>(
                isAi ? 'naming/aiGenerate' : 'naming/generate',
                payload,
                isAi ? AI_REQUEST_TIMEOUT_MS : undefined,
            )
            setResults((previous) => ({ ...previous, [payload.category]: result.items }))
            if (result.items.length === 0) {
                toast.error('当前条件可用的词素不足，未能生成名字，请放宽条件后重试')
            }
        } catch (cause) {
            toastError(cause)
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

    const hasResult = useCallback((target: NamingCategory): boolean => (results[target]?.length ?? 0) > 0, [results])

    return { items: results[category] ?? [], isGenerating, generate, abort, hasResult }
}
