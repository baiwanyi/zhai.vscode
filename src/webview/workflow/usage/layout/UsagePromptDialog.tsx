/**
 * 提示词弹窗：展示某条请求实际提交给模型的内容，以及该请求的模型、模块、tokens 与耗时。
 * 复用约定：弹层复用 ui/dialog（含无障碍标题与描述），错误用 alert 呈现，加载用 spinner；
 * 提示词正文整包来自宿主，本组件不做任何拼接或富文本渲染；复制走 ../utils 的 copyPrompt，结果用 sonner 提示。
 * 关键约束：以返回结果的 requestId 与当前请求比对判断是否就绪，切换请求时不会闪出上一条内容；
 * 未留存提示词（历史数据或已过期清理）显示空态文案而不是报错；正文只按纯文本展示，不解析 Markdown。
 */
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
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
import { copyPrompt, formatCredits, formatDuration, formatTokens, formatUsageTime, readModuleLabel } from '../utils'

interface UsagePromptDialogProps {
    item: AiUsageItem
    prompt: AiUsagePromptResult | null
    error: string | null
    onClose: () => void
}

export function UsagePromptDialog({ item, prompt, error, onClose }: UsagePromptDialogProps): JSX.Element {
    const isReady = prompt !== null && prompt.requestId === item.requestId
    const isMissing = isReady && !prompt.found
    /** 复制已留存的全部正文：内容被截断时只能复到前 20000 字符，界面上方另有说明 */
    const handleCopy = async (): Promise<void> => {
        const content = prompt === null ? '' : prompt.content
        if (content.length === 0) {
            return
        }
        const isSuccess = await copyPrompt(content)
        if (isSuccess) {
            toast.success('提示词已复制')
            return
        }
        toast.error('复制失败，请手动选中后复制')
    }

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
                    <DialogTitle className="text-lg">请求 {item.requestId}</DialogTitle>
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
                    {item.module === 'image' && (
                        <p className="w-full">模型列为驱动出图的文本模型；图像模型由 CLI 内部选择，不写入会话记录。</p>
                    )}
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
                    <p className="text-destructive">
                        {item.module === 'external'
                            ? '该轮不是由本扩展发起，没有提示词记录。'
                            : '该请求没有留存提示词（历史记录或已过期清理）。'}
                    </p>
                ) : (
                    <div className="flex flex-col min-h-0 gap-1 rounded-xl bg-composer-input/50 p-3">
                        <div className="flex items-center justify-between">
                            <span className="font-medium pl-3">提示词</span>
                            <Button size="icon" variant="ghost" onClick={() => void handleCopy()}>
                                <Copy className="size-4" />
                            </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-3 whitespace-pre-wrap wrap-break-word">
                            {prompt.content}
                        </div>
                        {prompt.isTruncated && <p className="text-muted-foreground">内容过长，仅保留前 20000 字符。</p>}
                    </div>
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
