/**
 * 提示词弹窗：展示某条请求实际提交给模型的内容，以及该请求的模型、模块、tokens 与耗时。
 * 复用约定：弹层复用 ui/dialog（含无障碍标题与描述），错误用 alert 呈现，加载用 spinner；
 * 提示词正文整包来自宿主，本组件不做任何拼接或富文本渲染。
 * 关键约束：以返回结果的 requestId 与当前请求比对判断是否就绪，切换请求时不会闪出上一条内容；
 * 未留存提示词（历史数据或已过期清理）显示空态文案而不是报错；正文只按纯文本展示，不解析 Markdown。
 */
import { Alert, AlertDescription } from '@components/ui/alert'
import { Button } from '@components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Spinner } from '@components/ui/spinner'
import type { AiUsageItem, AiUsagePromptResult } from '@shared/types/aiUsage'
import type { JSX } from 'react'
import { formatCredits, formatDuration, formatTokens, formatUsageTime, readModuleLabel, shortRequestId } from '../utils'

interface UsagePromptDialogProps {
    item: AiUsageItem
    prompt: AiUsagePromptResult | null
    error: string | null
    onClose: () => void
}

export function UsagePromptDialog({ item, prompt, error, onClose }: UsagePromptDialogProps): JSX.Element {
    const isReady = prompt !== null && prompt.requestId === item.requestId
    const isMissing = isReady && !prompt.found

    return (
        <Dialog
            open
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onClose()
                }
            }}
        >
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>请求 {shortRequestId(item.requestId)}</DialogTitle>
                    <DialogDescription>
                        {formatUsageTime(item.createdAt)} · {readModuleLabel(item.module)} ·{' '}
                        {item.model.length > 0 ? item.model : 'Auto'}
                    </DialogDescription>
                </DialogHeader>
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                        Tokens：{formatTokens(item.totalTokens)}（输入 {formatTokens(item.promptTokens)} / 输出{' '}
                        {formatTokens(item.completionTokens)}）
                    </span>
                    <span>积分：{formatCredits(item.credits)}</span>
                    <span>耗时：{formatDuration(item.durationMs)}</span>
                </div>
                {error !== null ? (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : !isReady ? (
                    <div className="text-muted-foreground flex items-center gap-2">
                        <Spinner />
                        正在读取提示词…
                    </div>
                ) : isMissing ? (
                    <p className="text-muted-foreground">该请求没有留存提示词（历史记录或已过期清理）。</p>
                ) : (
                    <>
                        {prompt.isTruncated && <p className="text-muted-foreground">内容过长，仅保留前 20000 字符。</p>}
                        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/40 p-3 whitespace-pre-wrap break-words">
                            {prompt.content}
                        </div>
                    </>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        关闭
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
