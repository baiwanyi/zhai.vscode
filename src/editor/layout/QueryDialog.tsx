/**
 * AI 查询弹窗：引用选中的片段，输入问题，按增量流式展示回答。
 * 复用约定：shadcn Dialog + Textarea + ScrollArea，结果复用 AI 对话的 MARKDOWN_COMPONENTS 渲染，
 * 查询状态由 useDocumentQuery 统一管理（含 clientId 匹配与中断）。
 * 关键约束：关闭必须先 abort——否则宿主会继续生成并计费；生成中只保留「停止」，
 * 避免用户连点发起多条并发请求。
 */
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { ScrollArea } from '@components/ui/scroll-area'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import { MARKDOWN_COMPONENTS } from '@webview/workflow/aichat/markdown'
import type { UseDocumentQueryResult } from '../hooks/useDocumentQuery'
import type { JSX } from 'react'

export interface QueryDialogProps {
    isOpen: boolean
    /** 选中的引用片段：只读展示 */
    quote: string
    onOpenChange: (isOpen: boolean) => void
    query: UseDocumentQueryResult
}

export function QueryDialog({ isOpen, quote, onOpenChange, query }: QueryDialogProps): JSX.Element {
    const [question, setQuestion] = useState('')
    const [isHistoryOpen, setIsHistoryOpen] = useState(false)
    /** 回看的答案：非空时优先展示它，用户点「查询」再清掉 */
    const [previewAnswer, setPreviewAnswer] = useState<string | null>(null)
    const { loadHistory } = query

    // 打开即拉历史：只在真正打开时请求一次
    useEffect(() => {
        if (isOpen) {
            void loadHistory()
        }
    }, [isOpen, loadHistory])

    /** 关闭统一走这里：中断在途请求并复位状态 */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            void query.abort()
            query.reset()
            setQuestion('')
            setIsHistoryOpen(false)
            setPreviewAnswer(null)
        }
        onOpenChange(nextOpen)
    }

    const isStreaming = query.status === 'streaming'
    const visibleContent = previewAnswer ?? query.content

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>AI 查询</DialogTitle>
                    <DialogDescription className="line-clamp-2 border-l-2 pl-2 text-muted-foreground">
                        {quote}
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    autoFocus
                    rows={3}
                    value={question}
                    placeholder="想问什么？留空则默认分析写作问题并给建议"
                    onChange={(event): void => {
                        setQuestion(event.target.value)
                    }}
                />
                {query.isFromCache && previewAnswer === null ? (
                    <p className="text-xs text-muted-foreground">来自缓存：本次未调用模型，也未消耗额度</p>
                ) : null}
                {visibleContent.length > 0 ? (
                    <ScrollArea className="max-h-72 rounded-md border p-3">
                        <div className="text-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                                {visibleContent}
                            </ReactMarkdown>
                        </div>
                    </ScrollArea>
                ) : null}
                {query.history.length === 0 ? null : (
                    <div className="flex flex-col gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-fit"
                            onClick={(): void => {
                                setIsHistoryOpen((previous) => !previous)
                            }}
                        >
                            最近查询（{query.history.length}）
                        </Button>
                        {isHistoryOpen ? (
                            <ScrollArea className="max-h-40 rounded-md border">
                                <div className="flex flex-col">
                                    {query.history.map((entry) => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            className="flex flex-col gap-0.5 border-b px-2 py-1.5 text-left last:border-b-0 hover:bg-accent"
                                            onClick={(): void => {
                                                setPreviewAnswer(entry.answer)
                                                setIsHistoryOpen(false)
                                            }}
                                        >
                                            <span className="line-clamp-1 text-xs text-muted-foreground">
                                                {entry.question}
                                            </span>
                                            <span className="line-clamp-1 text-xs">{entry.quote}</span>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        ) : null}
                    </div>
                )}
                {query.error === null ? null : <p className="text-xs text-destructive">{query.error}</p>}
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={(): void => {
                            handleOpenChange(false)
                        }}
                    >
                        关闭
                    </Button>
                    {isStreaming ? (
                        <Button
                            variant="ghost"
                            onClick={(): void => {
                                void query.abort()
                            }}
                        >
                            停止
                        </Button>
                    ) : (
                        <Button
                            isLoading={false}
                            onClick={(): void => {
                                // 发起新查询即退出回看态，否则会一直显示历史答案
                                setPreviewAnswer(null)
                                void query.start(quote, question)
                            }}
                        >
                            {query.status === 'done' ? '再查一次' : '查询'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
