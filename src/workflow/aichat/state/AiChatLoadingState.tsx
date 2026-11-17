/**
 * AI 对话运行时信息加载中的占位空态：会话数据尚未就绪时展示读取指示。
 * 复用 @components/ui 的 empty/spinner 组件，为纯展示组件、无任何回调依赖。
 */
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import type { JSX } from 'react'

/** 运行时信息加载中的占位空态 */
export function AiChatLoadingState(): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <Spinner />
                </EmptyMedia>
                <EmptyTitle>正在读取会话</EmptyTitle>
            </EmptyHeader>
        </Empty>
    )
}
