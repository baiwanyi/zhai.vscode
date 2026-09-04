/**
 * Webview 与扩展宿主之间的统一消息协议。
 * 设计源：docs/modules/common.md 第 7.3 节，请求-响应带 reqId 以支持并发匹配、超时与错误定位。
 */
export interface RequestMessage {
    type: 'request'
    reqId: string
    /** 协议方法名，如 'search/query'、'index/status' */
    method: string
    payload?: unknown
}

export interface ResponseMessage {
    type: 'response'
    reqId: string
    ok: boolean
    payload?: unknown
    error?: {
        code: string
        message: string
    }
}

/** 宿主 → Webview：流式增量（AI 输出、索引进度等） */
export interface StreamMessage {
    type: 'stream'
    reqId: string
    delta: string
    done: boolean
}

/** 宿主 → Webview：状态广播（索引就绪、配置变更、窗口聚焦） */
export interface StateMessage {
    type: 'state'
    channel: 'index' | 'config' | 'ai'
    payload: unknown
}

export type HostToWebviewMessage = ResponseMessage | StreamMessage | StateMessage

export type WebviewToHostMessage = RequestMessage

/** 判断是否为请求消息（类型收窄辅助） */
export function isRequestMessage(message: unknown): message is RequestMessage {
    return (
        typeof message === 'object'
        && message !== null
        && (message as { type?: unknown }).type === 'request'
        && typeof (message as { reqId?: unknown }).reqId === 'string'
        && typeof (message as { method?: unknown }).method === 'string'
    )
}
