/**
 * AI 解释条目：一条「查询文本 + 解释结果」的摘要，点击整条打开弹窗看详情。
 * 复用约定：骨架取 @components/ui/item 的槽位，详情弹窗取 @components/ui/dialog（标题 / 内容），
 * 删除确认取 @webview/components/ConfirmDialog，答案渲染复用 AI 对话的 MARKDOWN_COMPONENTS，
 * 按钮取 @webview/components/Button，时间走 shared/utils/format。
 * 关键约束：骨架与 AnnotationListItem 同构（媒体 / 内容 / 操作 / 页脚），两处列表的行高与文字起点一致；
 * 只关心文本与结果，不展示来源文档、也不提供跳转——解释的是文本本身，与在哪篇里查无关；
 * 删除走确认弹窗而不是行内二次点击：行内确认有超时，用户稍一犹豫就会重来，表现为「删不掉」；
 * 删除点击必须阻断冒泡，否则会顺带把详情弹窗打开。
 */
import { Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemFooter, ItemMedia, ItemTitle } from '@components/ui/item'
import { ScrollArea } from '@components/ui/scroll-area'
import type { EditorQueryRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { MARKDOWN_COMPONENTS } from '@webview/workflow/aichat/markdown'
import type { JSX, KeyboardEvent, MouseEvent } from 'react'

export interface QueryRecordItemProps {
    item: EditorQueryRecord
    onRemove: (id: string) => Promise<void>
}

export function QueryRecordItem({ item, onRemove }: QueryRecordItemProps): JSX.Element {
    const [isDetailOpen, setIsDetailOpen] = useState(false)
    const [isConfirmOpen, setIsConfirmOpen] = useState(false)

    /** 删除入口只负责弹确认框：行内二次点击会因超时失效，用户稍一犹豫就删不掉 */
    const handleRemove = (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation()
        setIsConfirmOpen(true)
    }

    /** 条目是 div，回车与空格要自己补上点击语义，键盘用户才能打开详情 */
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return
        }
        event.preventDefault()
        setIsDetailOpen(true)
    }

    return (
        <>
            <Item
                variant="outline"
                className="cursor-pointer"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onClick={(): void => {
                    setIsDetailOpen(true)
                }}
                aria-label={`查看 AI 解释：${item.quote}`}
            >
                <ItemMedia variant="icon">
                    <Sparkles className="text-muted-foreground" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-2 wrap-break-word">{item.quote}</ItemTitle>
                </ItemContent>
                <ItemActions>
                    <Button
                        variant="destructive"
                        size="icon-xs"
                        aria-label="删除 AI 解释"
                        onClick={handleRemove}
                        className="opacity-50 group-hover:opacity-100"
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                </ItemActions>
                <ItemFooter className="text-xs text-muted-foreground">
                    <span className="max-w-[50%] truncate">{item.model}</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                </ItemFooter>
            </Item>
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="text-lg">AI 解释</DialogTitle>
                        <DialogDescription className="text-xs border-l-2 border-primary pl-3">
                            {item.quote}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1">
                        <ScrollArea className="max-h-80 rounded-md border p-2">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                                {item.answer}
                            </ReactMarkdown>
                        </ScrollArea>
                        <p className="text-xs text-muted-foreground">
                            {item.model} · {formatDateTime(item.createdAt)}
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={isConfirmOpen}
                title="删除这条 AI 解释？"
                description="删除后不可恢复，同一段文本的解释缓存也会一并清掉。"
                confirmLabel="删除"
                isDestructive
                onOpenChange={setIsConfirmOpen}
                onConfirm={(): void => {
                    setIsConfirmOpen(false)
                    void onRemove(item.id)
                }}
            />
        </>
    )
}
