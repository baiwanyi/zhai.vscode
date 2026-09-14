/**
 * Webview 消息桥：封装 acquireVsCodeApi、reqId 请求-响应匹配与宿主推送（stream / state）订阅。
 * 约束：acquireVsCodeApi 全局仅可调用一次；响应按 reqId 匹配 resolve，请求侧自带超时。
 */
import type { StateMessage, StreamMessage } from '@/shared/types/messages'

interface VsCodeApi {
    postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

// 仅在 VSCode Webview 宿主内存在；浏览器预览环境下不存在，降级为 null 使页面可独立渲染
const api: VsCodeApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null

interface PendingEntry {
    resolve: (payload: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

const pendingRequests: Map<string, PendingEntry> = new Map()
const DEFAULT_TIMEOUT_MS = 10_000

/** 宿主推送的订阅者集合：流式增量与状态广播 */
const streamListeners = new Set<(message: StreamMessage) => void>()
const stateListeners = new Set<(message: StateMessage) => void>()

interface IncomingMessage {
    type?: string
    reqId?: string
    ok?: boolean
    payload?: unknown
    error?: { message?: string }
    delta?: unknown
}

window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as IncomingMessage
    if (message.type === 'stream' && typeof message.delta === 'string') {
        const streamMessage = message as unknown as StreamMessage
        for (const listener of streamListeners) {
            listener(streamMessage)
        }
        return
    }
    if (message.type === 'state') {
        const stateMessage = message as unknown as StateMessage
        for (const listener of stateListeners) {
            listener(stateMessage)
        }
        return
    }
    if (message.type !== 'response' || typeof message.reqId !== 'string') {
        return
    }
    const entry = pendingRequests.get(message.reqId)
    if (!entry) {
        return
    }
    clearTimeout(entry.timer)
    pendingRequests.delete(message.reqId)
    if (message.ok === false) {
        entry.reject(new Error(message.error?.message ?? '宿主返回未知错误'))
        return
    }
    entry.resolve(message.payload)
})

/** 向宿主发送请求并等待响应，超时自动拒绝避免永久挂起 */
export function request<T>(method: string, payload?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return new Promise<T>((resolve, reject) => {
        if (!api) {
            reject(new Error('当前为浏览器预览环境，宿主通信不可用'))
            return
        }
        const entry: PendingEntry = {
            resolve: (value) => resolve(value as T),
            reject,
            timer: setTimeout(() => {
                pendingRequests.delete(reqId)
                reject(new Error(`宿主请求超时：${method}（${timeoutMs}ms）`))
            }, timeoutMs),
        }
        pendingRequests.set(reqId, entry)
        api.postMessage({ type: 'request', reqId, method, payload })
    })
}

/** 订阅宿主流式增量，返回取消订阅函数 */
export function onStream(listener: (message: StreamMessage) => void): () => void {
    streamListeners.add(listener)
    return () => {
        streamListeners.delete(listener)
    }
}

/** 订阅宿主状态广播（如密钥变更、索引进度），返回取消订阅函数 */
export function onState(listener: (message: StateMessage) => void): () => void {
    stateListeners.add(listener)
    return () => {
        stateListeners.delete(listener)
    }
}
