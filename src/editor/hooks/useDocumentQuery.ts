/**
 * 编辑区查询状态机：发起查询、按 clientId 收流式增量、结束时收全文，关闭即中断。
 * 复用约定：请求走 bridge 的 request，增量与终态走 onState 的 editor 通道；
 * 每条 state 都必须校验 kind 与 clientId——同一扩展可能同时开着多个编辑器窗口。
 * 关键约束：关闭弹窗必须先 abort，否则宿主会继续计费；错误与取消都要落到可展示的文案上。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    EditorQueryDelta,
    EditorQueryDone,
    EditorQueryHistoryEntry,
    EditorQueryHistoryResult,
} from '@shared/types/editor'
import { onState, request } from '@shared/utils/bridge'

/** 查询状态：idle 空闲，streaming 生成中，done 完成，error 失败或取消 */
export type QueryStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface UseDocumentQueryResult {
    status: QueryStatus
    content: string
    error: string | null
    /** 本次结果来自缓存：界面标出「来自缓存」，说明未消耗额度 */
    isFromCache: boolean
    /** 当前文档的最近查询：弹窗打开时拉取，完成后刷新 */
    history: EditorQueryHistoryEntry[]
    /** 发起查询：quote 为选中文本，question 为空时宿主用默认问题 */
    start: (quote: string, question: string) => Promise<void>
    /** 中断当前查询：关闭弹窗、点停止都走这里 */
    abort: () => Promise<void>
    /** 拉取最近查询：打开弹窗与每次查询完成后调用 */
    loadHistory: () => Promise<void>
    /** 重置到空闲：下次打开弹窗时用 */
    reset: () => void
}

/** 收窄增量：字段齐备才算本次查询的数据 */
function isQueryDelta(input: unknown): input is EditorQueryDelta {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const value = input as { kind?: unknown; clientId?: unknown; delta?: unknown }
    return value.kind === 'query' && typeof value.clientId === 'string' && typeof value.delta === 'string'
}

/** 收窄终态：status 必须是两态之一 */
function isQueryDone(input: unknown): input is EditorQueryDone {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const value = input as { kind?: unknown; clientId?: unknown; status?: unknown; content?: unknown }
    return (
        value.kind === 'query' &&
        typeof value.clientId === 'string' &&
        (value.status === 'done' || value.status === 'error') &&
        typeof value.content === 'string'
    )
}

export function useDocumentQuery(path: string): UseDocumentQueryResult {
    const [status, setStatus] = useState<QueryStatus>('idle')
    const [content, setContent] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isFromCache, setIsFromCache] = useState(false)
    const [history, setHistory] = useState<EditorQueryHistoryEntry[]>([])
    const clientIdRef = useRef<string>('')

    const loadHistory = useCallback(async (): Promise<void> => {
        if (path.length === 0) {
            setHistory([])
            return
        }
        try {
            const result = await request<EditorQueryHistoryResult>('editor/query/history', { path })
            setHistory(result.items)
        } catch {
            // 历史是附加能力：拉取失败不影响查询本身
            setHistory([])
        }
    }, [path])

    const start = useCallback(
        async (quote: string, question: string): Promise<void> => {
            if (path.length === 0 || quote.trim() === '') {
                return
            }
            const clientId = crypto.randomUUID()
            clientIdRef.current = clientId
            setStatus('streaming')
            setContent('')
            setError(null)
            setIsFromCache(false)
            try {
                await request('editor/query', { path, quote, question, clientId })
            } catch (reason) {
                setStatus('error')
                setError(reason instanceof Error ? reason.message : '查询发起失败')
            }
        },
        [path],
    )

    const abort = useCallback(async (): Promise<void> => {
        const clientId = clientIdRef.current
        if (clientId.length === 0) {
            return
        }
        try {
            await request('editor/query/abort', { clientId })
        } catch {
            // 中断失败不覆盖已展示的内容：宿主侧会因超时自行结束
        }
    }, [])

    const reset = useCallback((): void => {
        setStatus('idle')
        setContent('')
        setError(null)
        clientIdRef.current = ''
    }, [])

    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'editor') {
                return
            }
            const payload = message.payload
            if (isQueryDelta(payload) && payload.clientId === clientIdRef.current) {
                setContent((previous) => previous + payload.delta)
                return
            }
            if (isQueryDone(payload) && payload.clientId === clientIdRef.current) {
                setContent(payload.content)
                setIsFromCache(payload.fromCache === true)
                if (payload.status === 'done') {
                    setStatus('done')
                    return
                }
                setStatus('error')
                setError(payload.reason ?? '查询失败')
            }
        })
    }, [])

    // 查询完成即刷新历史：用户刚问过的那条应立刻出现在列表里
    useEffect(() => {
        if (status === 'done') {
            void loadHistory()
        }
    }, [status, loadHistory])

    return { status, content, error, isFromCache, history, start, abort, loadHistory, reset }
}
