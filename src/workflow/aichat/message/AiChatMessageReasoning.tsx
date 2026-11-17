/**
 * AI 对话思考过程：把模型的思维链以可折叠轨迹呈现在助手消息上方。
 * 复用 @components/ui/trace 的轨迹行与折叠容器（图标 / 标题 / 字数 / 缩进竖线），不自建折叠头。
 * 关键约束：生成中且正文尚未开始时强制展开——此时没有正文，思考过程就是唯一可见进度；
 * 正文出现后自动收起为一行，由用户手动展开；思维链按纯文本展示，不进 Markdown 渲染，也不写入消息正文。
 */
import { Brain } from 'lucide-react'
import { useState } from 'react'
import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceDescription,
    TraceIcon,
    TraceLine,
    TraceTitle,
} from '@components/ui/trace'
import type { JSX } from 'react'

interface AiChatMessageReasoningProps {
    /** 思维链全文：流式期间是逐字累积结果，落定后是宿主落库快照 */
    reasoning: string
    /** 本轮是否仍在生成：决定标题文案与轨迹行的进行态 */
    isStreaming: boolean
    /** 正文是否已开始输出：已开始则收起，避免思考块挤占阅读区 */
    hasContent: boolean
}

export function AiChatMessageReasoning({
    reasoning,
    isStreaming,
    hasContent,
}: AiChatMessageReasoningProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    /** 等待首字阶段强制展开：正文为空时不应只剩一个转圈 */
    const isThinking = isStreaming && !hasContent
    return (
        <Trace className="mb-3">
            <TraceCollapsible open={isThinking || isOpen} onOpenChange={setIsOpen}>
                <TraceCollapsibleTrigger>
                    <TraceLine status={isStreaming ? 'running' : undefined}>
                        <TraceIcon>
                            <Brain />
                        </TraceIcon>
                        <TraceTitle>{isThinking ? '正在思考' : '思考过程'}</TraceTitle>
                        <TraceDescription>{reasoning.length} 字</TraceDescription>
                    </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {reasoning}
                </TraceCollapsibleContent>
            </TraceCollapsible>
        </Trace>
    )
}
