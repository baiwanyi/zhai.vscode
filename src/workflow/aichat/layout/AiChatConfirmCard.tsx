/**
 * 流内是/否确认卡片：承载「允许 / 拒绝」二选一的确认（写入类工具附内容预览），不再让用户填任何内容。
 * 复用 @components/ui 的 Card 槽位、badge 倒计时、trace 折叠行与 code-block 差异行、
 * @webview/components/Button，预览正文沿用上级目录 markdown 的主题映射。
 * 关键约束：用户必须在决定前读到将要写入的内容 —— 只报路径与动作等于让用户盲签，预览默认展开；
 * 说明文案整句由宿主下发、原样渲染，前端不拼半句，否则任一方改文案都会拼出病句；
 * 倒计时归零即按拒绝结算且只结算一次：超时、关闭、切会话都是拒绝，本组件也不把「允许」设为默认焦点；
 * 路径合法性仍由宿主重新校验，前端不做白名单判断，也不改写目标路径。
 */
import { FileText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '@components/ui/code-block'
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
import type { AiPermissionDecision, AiPermissionRequest, AiWritePreview } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { MARKDOWN_COMPONENTS } from '../markdown'
import { describeTool } from '../utils'

/** 倒计时刷新间隔：秒级足够，逐帧刷新只会让数字闪烁 */
const TICK_MS = 1000
/** 剩余时间的警戒线：进入这个窗口后倒计时改用破坏性配色，催用户尽快决定 */
const URGENT_REMAINING_MS = 10_000

interface AiChatConfirmCardProps {
    /** 待确认事项：kind 必为 tool */
    request: AiPermissionRequest
    /** 提交决定：允许时带回原目标路径，拒绝时只传 allowed=false */
    onSubmit: (decision: AiPermissionDecision) => void
}

/** 剩余毫秒：宿主未给期限返回 null，已到期返回 0 —— 前端不自行编造倒计时 */
function readRemainingMs(expiresAt: number | undefined): number | null {
    if (typeof expiresAt !== 'number' || expiresAt <= 0) {
        return null
    }
    return Math.max(expiresAt - Date.now(), 0)
}

/** 倒计时文案：只报到秒 —— 等待窗口本就以秒计，分钟位对这类短等待没有信息量 */
function formatRemaining(ms: number): string {
    return `${String(Math.ceil(ms / 1000))} 秒`
}

/** 预览摘要：处数与字数，截断时明确标注，避免把不完整的内容当成全文 */
function describePreview(preview: AiWritePreview[]): string {
    const total = preview.reduce((sum, segment) => sum + segment.content.length, 0)
    const size = total >= 1000 ? `${(total / 1000).toFixed(1)}k 字` : `${String(total)} 字`
    const truncated = preview.some((segment) => segment.truncated) ? ' · 已截断' : ''
    return preview.length > 1 ? `${String(preview.length)} 处 · ${size}${truncated}` : `${size}${truncated}`
}

/** 单段预览：整篇写入按 Markdown 正读，片段替换按删除 / 新增行对照 */
function WritePreviewSegment({ segment, index }: { segment: AiWritePreview; index: number }): JSX.Element {
    if (segment.removed === null) {
        return (
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {segment.content}
            </Markdown>
        )
    }
    const removedLines = segment.removed.split('\n')
    const addedLines = segment.content.split('\n')
    return (
        <CodeBlock>
            <CodeBlockHeader>
                <CodeBlockTitle>第 {index + 1} 处替换</CodeBlockTitle>
            </CodeBlockHeader>
            <CodeBlockContent wrap>
                {removedLines.map((line, lineIndex) => (
                    <CodeBlockLine key={`removed-${String(lineIndex)}`} variant="removed">
                        {line}
                    </CodeBlockLine>
                ))}
                {addedLines.map((line, lineIndex) => (
                    <CodeBlockLine key={`added-${String(lineIndex)}`} variant="added">
                        {line}
                    </CodeBlockLine>
                ))}
            </CodeBlockContent>
        </CodeBlock>
    )
}

export function AiChatConfirmCard({ request, onSubmit }: AiChatConfirmCardProps): JSX.Element {
    const action = describeTool(request.toolName)
    const preview = request.preview ?? []
    const [remainingMs, setRemainingMs] = useState<number | null>(() => readRemainingMs(request.expiresAt))
    // 预览默认展开：确认的全部意义就是先读到内容，默认收起等于把关键信息藏在一次点击之后
    const [isPreviewOpen, setIsPreviewOpen] = useState(true)
    /** 已结算标记：超时与点击可能同时到达，宿主侧只接受一次，这里先收口 */
    const settledRef = useRef(false)

    useEffect(() => {
        const expiresAt = request.expiresAt
        if (expiresAt === undefined || expiresAt <= 0) {
            return
        }
        const tick = (): void => {
            setRemainingMs(readRemainingMs(expiresAt))
        }
        const timer = setInterval(tick, TICK_MS)
        return (): void => {
            clearInterval(timer)
        }
    }, [request.expiresAt])

    const settle = useCallback(
        (decision: AiPermissionDecision): void => {
            if (settledRef.current) {
                return
            }
            settledRef.current = true
            onSubmit(decision)
        },
        [onSubmit],
    )

    const isExpired = remainingMs === 0
    /** 剩余不足警戒线：颜色变化就是催促，不额外加文案 */
    const isUrgent = remainingMs !== null && remainingMs < URGENT_REMAINING_MS

    // 到期自动按拒绝结算：用户没有选择也是一种选择，卡片不能挂在半空等宿主超时
    useEffect(() => {
        if (isExpired) {
            settle({ allowed: false })
        }
    }, [isExpired, settle])

    return (
        <Card size="sm" className="mx-1 my-6" role="group" aria-label={`${action}确认`}>
            <CardHeader>
                <CardTitle className="text-lg">允许{action}？</CardTitle>
                <CardAction>
                    {remainingMs === null ? null : (
                        <Badge variant={isUrgent ? 'destructive' : 'secondary'} role="timer">
                            {formatRemaining(remainingMs)}
                        </Badge>
                    )}
                </CardAction>
                <CardDescription>{request.effect}</CardDescription>
            </CardHeader>
            {preview.length === 0 ? null : (
                <CardContent>
                    <Trace>
                        <TraceCollapsible open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                            <TraceCollapsibleTrigger>
                                <TraceLine>
                                    <TraceIcon>
                                        <FileText />
                                    </TraceIcon>
                                    <TraceTitle>将要写入的内容</TraceTitle>
                                    <TraceDescription>{describePreview(preview)}</TraceDescription>
                                </TraceLine>
                            </TraceCollapsibleTrigger>
                            <TraceCollapsibleContent className="max-h-80 overflow-y-auto text-foreground">
                                <Trace>
                                    {preview.map((segment, index) => (
                                        <WritePreviewSegment
                                            key={`${String(index)}-${String(segment.content.length)}`}
                                            segment={segment}
                                            index={index}
                                        />
                                    ))}
                                </Trace>
                            </TraceCollapsibleContent>
                        </TraceCollapsible>
                    </Trace>
                </CardContent>
            )}
            {/* 两个出口必须等宽：权重相同才不会让「允许」看起来更像默认动作 */}
            <CardFooter className="gap-2 *:flex-1">
                <Button variant="outline" onClick={() => settle({ allowed: false })} disabled={isExpired}>
                    拒绝
                </Button>
                <Button
                    onClick={() => settle({ allowed: true, path: request.editablePath ?? '' })}
                    disabled={isExpired}
                >
                    允许
                </Button>
            </CardFooter>
        </Card>
    )
}
