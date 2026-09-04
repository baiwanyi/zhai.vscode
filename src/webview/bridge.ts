/**
 * Webview 消息桥：封装 acquireVsCodeApi 与 reqId 请求-响应匹配。
 * 约束：acquireVsCodeApi 全局仅可调用一次；响应按 reqId 匹配 resolve，请求侧自带超时。
 */

interface VsCodeApi {
    postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

const api: VsCodeApi = acquireVsCodeApi()

interface PendingEntry {
    resolve: (payload: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

const pendingRequests: Map<string, PendingEntry> = new Map()
const DEFAULT_TIMEOUT_MS = 10_000

window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type?: string; reqId?: string; ok?: boolean; payload?: unknown; error?: { message?: string } }
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
