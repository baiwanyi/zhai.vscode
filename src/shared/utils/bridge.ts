/**
 * 宿主消息桥：封装 acquireVsCodeApi、reqId 请求-响应匹配与宿主推送（stream / state）订阅。
 * 复用约定：方法名统一取 @shared/types/messages 的 HostMethodName，入站消息一律经类型守卫收窄，
 * 不对 event.data 做双重断言；错误统一包成 HostRequestError 保留原因码。
 * 关键约束：acquireVsCodeApi 全局仅可调用一次；响应按 reqId 匹配 resolve，请求侧自带超时；
 * 浏览器预览环境没有宿主，request 直接拒绝而不是静默挂起；未知通道与畸形消息一律丢弃，
 * 避免订阅者按不可信数据分支。
 */
import { isResponseMessage, isStateMessage, isStreamMessage } from '@shared/types/messages'
import type { HostMethodName, RequestMessage, StateMessage, StreamMessage } from '@shared/types/messages'

interface VsCodeApi {
    postMessage(message: RequestMessage): void
}

declare function acquireVsCodeApi(): VsCodeApi

// 仅在 VSCode Webview 宿主内存在；浏览器预览环境下不存在，降级为 null 使页面可独立渲染
const api: VsCodeApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null

interface PendingEntry {
    resolve: (payload: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

/**
 * 宿主返回的业务错误：保留原因码，供调用方按码分发提示文案。
 * 仍继承 Error，既有 toastError 之类的兜底展示无需改动。
 */
export class HostRequestError extends Error {
    public constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message)
        this.name = 'HostRequestError'
    }
}

const pendingRequests: Map<string, PendingEntry> = new Map()
const DEFAULT_TIMEOUT_MS = 10_000

/** 宿主推送的订阅者集合：流式增量与状态广播 */
const streamListeners = new Set<(message: StreamMessage) => void>()
const stateListeners = new Set<(message: StateMessage) => void>()

window.addEventListener('message', (event: MessageEvent) => {
    const message: unknown = event.data
    if (isStreamMessage(message)) {
        for (const listener of streamListeners) {
            listener(message)
        }
        return
    }
    if (isStateMessage(message)) {
        for (const listener of stateListeners) {
            listener(message)
        }
        return
    }
    if (!isResponseMessage(message)) {
        return
    }
    const entry = pendingRequests.get(message.reqId)
    if (!entry) {
        return
    }
    clearTimeout(entry.timer)
    pendingRequests.delete(message.reqId)
    if (!message.ok) {
        const code = message.error?.code ?? 'unknown'
        entry.reject(new HostRequestError(code, message.error?.message ?? '宿主返回未知错误'))
        return
    }
    entry.resolve(message.payload)
})

/**
 * 向宿主发送请求并等待响应，超时自动拒绝避免永久挂起。
 * 方法名受 HostMethodName 约束（编译期防拼写错误），返回值类型由调用方用泛型标注。
 */
export function request<T = unknown>(
    method: HostMethodName,
    payload?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
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
