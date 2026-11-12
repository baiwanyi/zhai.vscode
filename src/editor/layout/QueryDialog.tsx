/**
 * AI 查询弹窗：引用选中的片段，输入问题，按增量流式展示回答。
 * 复用约定：shadcn Dialog + Textarea + ScrollArea，结果复用 AI 对话的 MARKDOWN_COMPONENTS 渲染，
 * 查询状态由 useDocumentQuery 统一管理（含 clientId 匹配与中断）。
 * 关键约束：关闭必须先 abort——否则宿主会继续生成并计费；生成中只保留「停止」，
 * 避免用户连点发起多条并发请求。
 */
import { useState } from 'react'
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

    /** 关闭统一走这里：中断在途请求并复位状态 */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            void query.abort()
            query.reset()
            setQuestion('')
        }
        onOpenChange(nextOpen)
    }

    const isStreaming = query.status === 'streaming'

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
                {query.content.length > 0 ? (
                    <ScrollArea className="max-h-72 rounded-md border p-3">
                        <div className="text-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                                {query.content}
                            </ReactMarkdown>
                        </div>
                    </ScrollArea>
                ) : null}
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
