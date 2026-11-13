/**
 * AI 解释条目：一条「查询文本 + 解释结果」的摘要，支持展开答案与删除。
 * 复用约定：骨架取 @components/ui/item 的槽位，按钮取 @webview/components/Button，
 * 答案渲染复用 AI 对话的 MARKDOWN_COMPONENTS，时间格式化复用 shared/utils/format。
 * 关键约束：只关心文本与结果，不展示来源文档、也不提供跳转——解释的是文本本身，与在哪篇里查无关；
 * 删除要行内二次确认（与标注条目同一交互，避免嵌套弹窗抢焦点）；
 * 答案默认折叠——解释往往很长，全部展开会把下方的标注列表挤出视口。
 */
import { Check, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@components/ui/item'
import { ScrollArea } from '@components/ui/scroll-area'
import type { EditorQueryRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { MARKDOWN_COMPONENTS } from '@webview/workflow/aichat/markdown'
import type { JSX } from 'react'

/** 二次确认的等待时长：与标注条目保持一致 */
const CONFIRM_TIMEOUT_MS = 3000

export interface QueryRecordItemProps {
    item: EditorQueryRecord
    onRemove: (id: string) => Promise<void>
}

export function QueryRecordItem({ item, onRemove }: QueryRecordItemProps): JSX.Element {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isConfirming, setIsConfirming] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    /** 删除二次确认：第一次点只切换成「确认」，3 秒内再点才真的删 */
    const handleRemove = (): void => {
        if (!isConfirming) {
            setIsConfirming(true)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
            }
            timerRef.current = setTimeout((): void => {
                setIsConfirming(false)
                timerRef.current = null
            }, CONFIRM_TIMEOUT_MS)
            return
        }
        setIsConfirming(false)
        void onRemove(item.id)
    }

    return (
        <Item variant="outline" className="items-start">
            <ItemMedia variant="icon" className="mt-0.5">
                <Sparkles />
            </ItemMedia>
            <ItemContent>
                <ItemTitle className="line-clamp-2">{item.quote}</ItemTitle>
                {isExpanded ? (
                    <ScrollArea className="max-h-60 rounded-md border p-2">
                        <div className="text-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                                {item.answer}
                            </ReactMarkdown>
                        </div>
                    </ScrollArea>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{formatDateTime(item.createdAt)}</span>
                </div>
            </ItemContent>
            <ItemActions>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={(): void => {
                        setIsExpanded((previous) => !previous)
                    }}
                >
                    {isExpanded ? '收起' : '展开'}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={isConfirming ? '确认删除' : '删除 AI 解释'}
                    onClick={handleRemove}
                >
                    {isConfirming ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
                </Button>
            </ItemActions>
        </Item>
    )
}
