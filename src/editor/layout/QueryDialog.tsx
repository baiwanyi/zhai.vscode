/**
 * AI 解释弹窗：引用选中的片段或整块文本，展示含义解释与相关背景资料。
 * 复用约定：shadcn Dialog + ScrollArea，结果复用 AI 对话的 MARKDOWN_COMPONENTS 渲染，
 * 查询状态由 useDocumentQuery 统一管理（含 clientId 匹配、缓存与中断）。
 * 关键约束：弹窗没有输入框、没有重试也没有停止——打开即用固定问题发起一次查询，
 * 生成期间只给 Marker 等待态，等宿主返回完整结果后才渲染正文，不展示流式增量；
 * 关闭即 abort 并复位，关闭后再打开才算新的一次；
 * 自动发起用 ref 只放行一次：query 每次渲染都换对象，只靠 effect 依赖会重复请求。
 */
import { CircleAlertIcon, InfoIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Marker, MarkerContent, MarkerIcon } from '@components/ui/marker'
import { ScrollArea } from '@components/ui/scroll-area'
import { MARKDOWN_COMPONENTS } from '@webview/workflow/aichat/markdown'
import type { UseDocumentQueryResult } from '../hooks/useDocumentQuery'
import type { JSX } from 'react'

/** 固定提问：两个入口都只解释文本含义与相关引用，不接受自由提问 */
const EXPLAIN_QUESTION = '请解释这段文字的意思，并补充与之相关的背景、典故或可引用的资料，不需要改写建议'

export interface QueryDialogProps {
    isOpen: boolean
    /** 选中的引用片段或整块文本：只读展示 */
    quote: string
    onOpenChange: (isOpen: boolean) => void
    query: UseDocumentQueryResult
}

export function QueryDialog({ isOpen, quote, onOpenChange, query }: QueryDialogProps): JSX.Element {
    const { start } = query
    /** 本次打开是否已发起：query 每次渲染都换对象，只靠依赖去重会重复请求 */
    const hasAutoStartedRef = useRef(false)

    // 打开就发一次查询：没有输入框也没有提交按钮，用户不该再等一次点击
    useEffect(() => {
        if (!isOpen) {
            hasAutoStartedRef.current = false
            return
        }
        if (hasAutoStartedRef.current) {
            return
        }
        hasAutoStartedRef.current = true
        void start(quote, EXPLAIN_QUESTION)
    }, [isOpen, quote, start])

    /** 关闭统一走这里：中断在途请求并复位状态 */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            void query.abort()
            query.reset()
        }
        onOpenChange(nextOpen)
    }

    const isEmpty = quote.trim().length === 0
    // 打开到结果返回之间都算等待：只看 streaming 会在请求真正发出前闪一下空白
    const isPending = !isEmpty && (query.status === 'idle' || query.status === 'streaming')

    /** 正文之外的说明统一汇总成一条：空文本优先于缓存命中，两者互斥，渲染位置也只有一个 */
    function readNotice(): string | null {
        if (isPending) {
            return null
        }
        if (isEmpty) {
            return '没有可解释的文本'
        }
        if (query.isFromCache) {
            return '来自缓存：本次未调用模型，也未消耗额度'
        }
        return null
    }

    const notice = readNotice()

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="text-lg">AI 查询</DialogTitle>
                    <DialogDescription className="line-clamp-2 border-l-2 pl-2 text-muted-foreground">
                        {quote}
                    </DialogDescription>
                </DialogHeader>
                {/* 生成期间只给等待态：增量不展示，结果一次性出现，避免边出边跳 */}
                {isPending ? (
                    <Marker role="status">
                        <MarkerIcon>
                            <Loader2Icon className="animate-spin" />
                        </MarkerIcon>
                        <MarkerContent>正在查询…</MarkerContent>
                    </Marker>
                ) : null}
                {notice === null ? null : (
                    <Alert>
                        <InfoIcon />
                        <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                )}
                {!isPending && query.content.length > 0 ? (
                    <ScrollArea className="max-h-72 min-h-0">
                        <div className="px-3 pb-3">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                                {query.content}
                            </ReactMarkdown>
                        </div>
                    </ScrollArea>
                ) : null}
                {query.error === null || isPending ? null : (
                    <Alert variant="destructive">
                        <CircleAlertIcon />
                        <AlertTitle>查询失败</AlertTitle>
                        <AlertDescription>{query.error}</AlertDescription>
                    </Alert>
                )}
                {/* 关闭统一交给 DialogContent 右上角的默认关闭按钮，footer 不再重复一个 */}
            </DialogContent>
        </Dialog>
    )
}
