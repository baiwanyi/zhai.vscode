/**
 * AI 解释详情弹窗：引用原文 + 完整解释正文，正文按 Markdown 渲染并在弹窗内限高滚动。
 * 复用约定：外壳取 @components/ui 的 dialog 与 scroll-area，正文取 @webview/blocks/Markdown，
 * 元信息行复用 shared/utils/format 的时间口径。
 * 关键约束：开合状态由调用方持有——条目自己控制打开，弹窗只呈现并回传关闭；
 * 答案可能很长，滚动限制在弹窗内，不撑高页面；不展示来源文档，解释的是文本本身。
 */
'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { ScrollArea } from '@components/ui/scroll-area'
import type { EditorQueryRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Markdown } from '@webview/blocks/Markdown'
import type { JSX } from 'react'

export interface QueryRecordDetailDialogProps {
    record: EditorQueryRecord
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function QueryRecordDetailDialog({ record, isOpen, onOpenChange }: QueryRecordDetailDialogProps): JSX.Element {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg">AI 解释</DialogTitle>
                    <DialogDescription className="text-xs border-l-2 border-primary pl-3">
                        {record.quote}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1">
                    <ScrollArea className="max-h-80 rounded-md border p-2">
                        <Markdown content={record.answer} />
                    </ScrollArea>
                    <p className="text-xs text-muted-foreground">
                        {record.model} · {formatDateTime(record.createdAt)}
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    )
}
