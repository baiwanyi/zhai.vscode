/**
 * AI 对话消息正文：用户消息交给 AiChatMessageUserBody（命令徽章 + 补充文本），助手回复经 unified/remark 渲染 Markdown，
 * 思维链与执行过程分别由同目录 AiChatMessageReasoning / AiChatMessageSteps 以可折叠轨迹排在正文上方，
 * 待确认事项（写入确认 / 模型提问）以流内卡片附在正文之后。
 * 复用上级目录 markdown.tsx 的主题映射、同目录用户正文 / 思考过程 / 步骤 / 审批问卷组件、
 * @components/ui 的 Marker 与 Spinner。
 * 关键约束：有思维链或步骤时优先展示它们——等待首字期间这就是主体，正文出现后各自收起为一行；
 * 确认卡片优先于加载态：等待确认期间流已暂停，再转圈会让人以为还在生成；
 * 其余空内容按状态占位（失败 / 已停止给文案，待首字给「正在思考…」状态行，已完成空回复不渲染），
 * 不渲染空段落，也不留裸转圈——没有文字的进度无法区分「在思考」和「卡住」；
 * 用户消息的命令拆分不改变落库内容，思维链、步骤与确认卡片只属于助手消息。
 */
import { CircleSlash } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Marker, MarkerContent, MarkerIcon } from '@components/ui/marker'
import { Spinner } from '@components/ui/spinner'
import type { AiMessage, AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'
import { AiChatConfirmCard } from './AiChatConfirmCard'
import { AiChatMessageReasoning } from './AiChatMessageReasoning'
import { AiChatMessageSteps } from './AiChatMessageSteps'
import { AiChatMessageUserBody } from './AiChatMessageUserBody'
import { AiChatQuestionnaire } from './AiChatQuestionnaire'
import type { JSX } from 'react'
import { MARKDOWN_COMPONENTS } from '../markdown'

interface AiChatMessageBodyProps {
    message: AiMessage
    /** 挂在本条消息下的待确认事项：null 表示没有 */
    pendingApproval: AiPermissionRequest | null
    /** 提交确认决定：允许与放弃共用同一入口 */
    onAnswer: (decision: AiPermissionDecision) => void
}

export function AiChatMessageBody({ message, pendingApproval, onAnswer }: AiChatMessageBodyProps): JSX.Element | null {
    const reasoning = message.reasoning ?? ''
    const hasReasoning = message.role === 'assistant' && reasoning.length > 0
    const isStreaming = message.status === 'pending' || message.status === 'streaming'
    /** 思考块：正文为空时单独占位，正文出现后折叠在正文上方 */
    const reasoningBlock = hasReasoning ? (
        <AiChatMessageReasoning
            reasoning={reasoning}
            isStreaming={isStreaming}
            hasContent={message.content.length > 0}
        />
    ) : null
    /** 步骤块：只在助手消息且有过程时渲染，空列表不进 DOM */
    const stepsBlock =
        message.role === 'assistant' && message.steps.length > 0 ? (
            <AiChatMessageSteps steps={message.steps} isStreaming={isStreaming} />
        ) : null
    /**
     * 确认块：二选一的写入确认走确认卡片，多题提问走问卷；按事项 id 重挂载，
     * 切换事项或重试时表单状态自然复位。
     */
    const approvalBlock =
        pendingApproval === null || message.role !== 'assistant' ? null : pendingApproval.kind === 'tool' ? (
            <AiChatConfirmCard key={pendingApproval.id} request={pendingApproval} onSubmit={onAnswer} />
        ) : (
            <AiChatQuestionnaire
                key={pendingApproval.id}
                questions={pendingApproval.questions}
                expiresAt={pendingApproval.expiresAt}
                onSubmit={onAnswer}
            />
        )

    if (message.content.length > 0) {
        return (
            <>
                {reasoningBlock}
                {stepsBlock}
                {message.role === 'user' ? (
                    <AiChatMessageUserBody message={message} />
                ) : (
                    <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                        {message.content}
                    </Markdown>
                )}
                {approvalBlock}
            </>
        )
    }
    if (reasoningBlock !== null || stepsBlock !== null) {
        return (
            <>
                {reasoningBlock}
                {stepsBlock}
                {approvalBlock}
            </>
        )
    }
    if (approvalBlock !== null) {
        return approvalBlock
    }
    // 失败与主动停止都可能没有任何产出：用状态行标注，而不是留一句裸文本
    if (message.status === 'failed' || message.status === 'cancelled') {
        return (
            <Marker role="status">
                <MarkerIcon>
                    <CircleSlash />
                </MarkerIcon>
                <MarkerContent>未产生内容</MarkerContent>
            </Marker>
        )
    }
    // 只有待首字与流式中才是加载态：已完成的空回复不再转圈，交由调用方决定是否展示；
    // 光转圈不写字会让人分不清「正在思考」和「卡住了」，文案与进度行同属状态播报
    return isStreaming ? (
        <Marker role="status">
            <MarkerIcon>
                <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">正在思考…</MarkerContent>
        </Marker>
    ) : null
}
