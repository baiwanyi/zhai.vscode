/**
 * AI 对话单条消息：按角色分派 —— 用户 default 右对齐、助手 ghost 通栏、系统事件走流内标记。
 * 正文（含用户消息首行的命令与引用徽章）与统计工具栏分别由同目录独立组件渲染，
 * 本层只负责结构编排与状态分派；用户消息的操作按钮挂在气泡外（气泡下方右对齐），悬停整条消息才淡入。
 * 关键约束：错误信息统一用 Alert（破坏性变体）呈现；取消态只有带中文说明时才出 Alert
 * （拒绝写入 / 审批超时），主动停止仍是一行状态文案 —— 前者要够醒目，后者是用户的正常操作；
 * 工具栏只在助手消息生成落定（完成 / 失败 / 停止）且有正文时出现，流式中不出现；
 * 系统事件不进气泡：压缩完成用居中分隔标记，其余用普通状态行，
 * 且分隔线不得加 role="separator" —— 子内容会被当作纯装饰，可见标签读不出来；
 * 用户复制带上命令名与引用标签（指令模板不进剪贴板），正文与徽章都为空时不渲染按钮；
 * 「重新填入输入框」只恢复命令与正文，引用不恢复 —— 历史引用可能已失效，宿主清单只能按文件重新解析。
 */
import { Check, CircleAlert, CircleSlash, Copy, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Bubble, BubbleContent, BubbleGroup } from '@components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@components/ui/message'
import type { AiMessage, AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'
import { copyToClipboard } from '@shared/utils/clipboard'
import { Button } from '@webview/components/Button'
import { AiChatMessageActions } from './AiChatMessageActions'
import { AiChatMessageBody } from './AiChatMessageBody'
import type { JSX, ReactNode } from 'react'
import { toMessageCopyText } from '../utils'

/** 复制成功的图标停留时长：够看清，又不至于一直挂在勾上 */
const COPIED_RESET_MS = 2000
/** 存量数据里可能残留的 CLI 英文内部错误：不该再露给用户 */
const INTERNAL_ERROR_PATTERN = /interrupted by user|permission denied for tool/i

interface AiChatMessageViewProps {
    message: AiMessage
    /** 挂在本条消息下的待确认事项：由调用方按 messageId 命中后传入 */
    pendingApproval: AiPermissionRequest | null
    /** 提交确认决定 */
    onAnswer: (decision: AiPermissionDecision) => void
    /** 重复一条消息：由调用方决定回填范围，本组件只上报意图；缺省不渲染入口 */
    onRepeat?: (message: AiMessage) => void
}

/** 气泡外的图标按钮：尺寸、配色与无障碍名统一，复制与重复共用一个外壳 */
function MessageIconButton({
    label,
    onClick,
    children,
}: {
    label: string
    onClick: () => void
    children: ReactNode
}): JSX.Element {
    return (
        <Button
            variant="ghost"
            size="icon-xs"
            tooltip={label}
            aria-label={label}
            className="text-muted-foreground hover:text-foreground"
            onClick={onClick}
        >
            {children}
        </Button>
    )
}

/**
 * 用户消息复制按钮：放在气泡外，避免占用户正文的行宽，也让气泡内的排版只服务内容。
 * 关键约束：成功才切对勾，失败只提示不谎报；键盘聚焦时由外层 footer 的 focus-within 显示。
 */
function UserCopyButton({ text }: { text: string }): JSX.Element {
    const [isCopied, setIsCopied] = useState(false)

    useEffect(() => {
        if (!isCopied) {
            return
        }
        const timer = setTimeout((): void => {
            setIsCopied(false)
        }, COPIED_RESET_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [isCopied])

    async function handleCopy(): Promise<void> {
        const isSuccess = await copyToClipboard(text)
        if (!isSuccess) {
            toast.error('复制失败，请手动选中后复制')
            return
        }
        setIsCopied(true)
    }

    return (
        <MessageIconButton label={isCopied ? '已复制' : '复制'} onClick={() => void handleCopy()}>
            {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </MessageIconButton>
    )
}

/**
 * 落定后的状态区：有说明用 Alert，取消态没有说明只留一行「已停止生成」。
 * 关键约束：两者互斥 —— 出了 Alert 就不再补状态行，避免同一件事说两遍。
 */
function MessageStatus({ text, isCancelled }: { text: string | null; isCancelled: boolean }): JSX.Element | null {
    if (text !== null) {
        return (
            <Alert variant="destructive" className="me-1">
                <CircleAlert />
                <AlertDescription>{text}</AlertDescription>
            </Alert>
        )
    }
    if (!isCancelled) {
        return null
    }
    return (
        <Marker role="status">
            <MarkerIcon>
                <CircleSlash />
            </MarkerIcon>
            <MarkerContent>已停止生成</MarkerContent>
        </Marker>
    )
}

export function AiChatMessageView({
    message,
    pendingApproval,
    onAnswer,
    onRepeat,
}: AiChatMessageViewProps): JSX.Element {
    if (message.role === 'system') {
        return message.finishReason === 'compacted' ? (
            <Marker variant="separator">
                <MarkerContent>{message.content}</MarkerContent>
            </Marker>
        ) : (
            <Marker role="status">
                <MarkerContent>{message.content}</MarkerContent>
            </Marker>
        )
    }
    const isUser = message.role === 'user'
    const isCancelled = message.status === 'cancelled'
    /** 生成已落定：流式过程中不展示工具栏，避免用量与耗时是半成品 */
    const isSettled = message.status === 'completed' || message.status === 'failed' || isCancelled
    /**
     * 错误原文：空串按无错误处理，避免出现一行空白提示；失败但没带原文时给兜底文案。
     * 取消态只在带原文时才展示 —— 拒绝写入与审批超时由宿主写入中文说明，需要让用户知道为什么停了；
     * 用户主动停止以及存量数据里的 CLI 英文内部错误一律不展示，只留一行「已停止生成」。
     */
    const rawError = message.error ?? ''
    const failureText = rawError.length > 0 && !INTERNAL_ERROR_PATTERN.test(rawError) ? rawError : null
    const errorText = failureText ?? (message.status === 'failed' ? '生成失败' : null)
    /** 可复制的用户内容：命令名与引用标签随正文一起进剪贴板，指令模板不进去 */
    const copyText = isUser ? toMessageCopyText(message) : ''
    /** 正文只随气泡外观变化，取出来复用，避免两个分支各写一遍同样的入参 */
    const body = <AiChatMessageBody message={message} pendingApproval={pendingApproval} onAnswer={onAnswer} />
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageContent>
                <BubbleGroup className="w-full">
                    {isUser ? (
                        <Bubble variant="default">
                            <BubbleContent className="flex w-max max-w-full flex-col gap-1.5 whitespace-pre-wrap">
                                {body}
                            </BubbleContent>
                        </Bubble>
                    ) : (
                        <Bubble variant="ghost" className="w-full">
                            {/* BubbleContent 默认 w-fit：宽度跟着内容长，思考过程流式输出时
                                会一行行变宽。助手消息本就通栏，这里显式撑满 */}
                            <BubbleContent className="w-full">{body}</BubbleContent>
                        </Bubble>
                    )}
                </BubbleGroup>
                {copyText.length > 0 ? (
                    <MessageFooter className="opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
                        {onRepeat === undefined ? null : (
                            <MessageIconButton label="重新填入输入框" onClick={() => onRepeat(message)}>
                                <Undo2 className="size-3.5" />
                            </MessageIconButton>
                        )}
                        <UserCopyButton text={copyText} />
                    </MessageFooter>
                ) : null}
                <MessageStatus text={errorText} isCancelled={isCancelled} />
                {isUser || !isSettled || message.content.length === 0 ? null : (
                    <MessageFooter>
                        <AiChatMessageActions message={message} />
                    </MessageFooter>
                )}
            </MessageContent>
        </Message>
    )
}
