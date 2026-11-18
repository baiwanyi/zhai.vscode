/**
 * AI 对话运行时信息加载中的占位空态：会话数据尚未就绪时展示读取指示。
 * 复用业务公共层的 StateEmpty（默认 logo + 转圈 + 文案），与工作流其他加载态同一外观；
 * 本组件只做文案绑定，不持有状态、不依赖回调。
 */
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'

/** 运行时信息加载中的占位空态 */
export function AiChatLoadingState(): JSX.Element {
    return <StateEmpty title="正在读取会话..." isLoading />
}
