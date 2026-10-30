/**
 * 留言管理页：按「已推送批次 → 文章」筛选留言，支持回复、加精与删除。
 * 复用约定：数据取 hooks/useWechatComments，外壳取 AppPage，批次与文章用两个 Select，
 * 留言条目用 ui/item + badge，删除走公共 ConfirmDialog（不可撤销必须二次确认）。
 * 关键约束：只有已推送的批次可选——草稿态没有群发消息标识，选它只会拿到宿主的拒绝提示；
 * 留言内容按原文展示（保留换行），不做 Markdown 渲染，避免读者输入被当作文档解释；
 * 删除前弹确认，回复在行内展开，不跳页面也不弹窗。
 */
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Item, ItemActions, ItemDescription } from '@components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Skeleton } from '@components/ui/skeleton'
import { Textarea } from '@components/ui/textarea'
import type { WechatAccountSummary, WechatCommentSummary } from '@shared/types/wechat'
import { WECHAT_COMMENT_CONTENT_MAX } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import type { JSX } from 'react'
import { useWechatComments } from '../hooks/useWechatComments'

/** 读者身份只露 openid 尾号：正文里放完整 openid 既无用也不该随手展示 */
function readFanLabel(openid: string): string {
    return openid.length > 6 ? `读者 …${openid.slice(-6)}` : '读者'
}

interface WechatCommentPageProps {
    account: WechatAccountSummary
}

export function WechatCommentPage({ account }: WechatCommentPageProps): JSX.Element {
    const state = useWechatComments(account.id)
    /** 正在回复的留言 id：null 表示没有展开的回复框 */
    const [replyingId, setReplyingId] = useState<number | null>(null)
    const [replyDraft, setReplyDraft] = useState('')
    const [pendingRemove, setPendingRemove] = useState<WechatCommentSummary | null>(null)

    const selectedIssue = state.issues.find((issue) => issue.id === state.selectedIssueId)

    const handleOpenReply = (comment: WechatCommentSummary): void => {
        setReplyingId(comment.id)
        setReplyDraft(comment.replyContent ?? '')
    }

    const handleSubmitReply = async (): Promise<void> => {
        if (replyingId === null || replyDraft.trim().length === 0) {
            return
        }
        const isReplied = await state.reply(replyingId, replyDraft.trim())
        if (isReplied) {
            setReplyingId(null)
            setReplyDraft('')
        }
    }

    const renderComment = (comment: WechatCommentSummary): JSX.Element => (
        <Item key={comment.id} variant="outline" className="flex-col items-stretch gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <ItemDescription className="text-xs">
                    {`${readFanLabel(comment.openid)} · ${formatRelativeTime(comment.createdAt)}`}
                </ItemDescription>
                {comment.isElected && <Badge variant="secondary">精选</Badge>}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{comment.content}</p>
            {comment.replyContent !== undefined && (
                <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs">
                    {`作者回复：${comment.replyContent}`}
                </p>
            )}
            {replyingId === comment.id ? (
                <div className="flex flex-col gap-2">
                    <Textarea
                        value={replyDraft}
                        rows={2}
                        maxLength={WECHAT_COMMENT_CONTENT_MAX}
                        placeholder="写一条回复"
                        disabled={state.isMutating}
                        onChange={(event) => setReplyDraft(event.target.value)}
                    />
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setReplyingId(null)}>
                            取消
                        </Button>
                        <Button
                            size="sm"
                            variant="primary"
                            isLoading={state.isMutating}
                            disabled={replyDraft.trim().length === 0}
                            onClick={() => void handleSubmitReply()}
                        >
                            回复
                        </Button>
                    </div>
                </div>
            ) : (
                <ItemActions className="justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={state.isMutating}
                        onClick={() => handleOpenReply(comment)}
                    >
                        {comment.replyContent === undefined ? '回复' : '改回复'}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={state.isMutating}
                        onClick={() => void state.mark(comment.id, !comment.isElected)}
                    >
                        {comment.isElected ? '取消精选' : '设为精选'}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={state.isMutating}
                        onClick={() => setPendingRemove(comment)}
                    >
                        删除
                    </Button>
                </ItemActions>
            )}
        </Item>
    )

    const renderBody = (): JSX.Element => {
        if (state.status === 'loading') {
            return (
                <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                </div>
            )
        }
        if (state.status === 'error') {
            return (
                <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-sm">留言读取失败</p>
                    <p className="text-xs text-muted-foreground">{state.error ?? '请稍后重试'}</p>
                    <Button variant="outline" onClick={() => void state.reload()}>
                        重试
                    </Button>
                </div>
            )
        }
        if (state.issues.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <MessageSquare className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>没有可查看留言的文章</EmptyTitle>
                        <EmptyDescription>
                            留言挂在已群发的文章上：先在仪表盘批次页生成草稿并群发成功，批次出现在这里后才能查看留言。
                        </EmptyDescription>
                        <EmptyDescription>
                            另外，留言功能需要账号已开通（2018
                            年后注册的账号默认没有）。若群发后仍查不到，通常是平台未开通该能力。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        if (state.comments.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>这篇文章还没有留言</EmptyTitle>
                        <EmptyDescription>读者留言后会出现在这里；也可能是该账号未开通留言功能。</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-2">
                {state.comments.map(renderComment)}
                {state.comments.length < state.total && (
                    <Button variant="outline" isLoading={state.isMutating} onClick={() => void state.loadMore()}>
                        {`加载更多（已显示 ${String(state.comments.length)}/${String(state.total)}）`}
                    </Button>
                )}
            </div>
        )
    }

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>留言管理</AppTitle>
                    <AppDescription>
                        {selectedIssue === undefined ? account.name : `${account.name} · ${String(state.total)} 条留言`}
                    </AppDescription>
                    {state.issues.length > 0 && (
                        <AppMenu>
                            <Select
                                value={state.selectedIssueId ?? ''}
                                onValueChange={(value) => state.selectIssue(value)}
                            >
                                <SelectTrigger size="sm" aria-label="选择批次" className="min-w-28 flex-1">
                                    <SelectValue placeholder="批次" />
                                </SelectTrigger>
                                <SelectContent>
                                    {state.issues.map((issue) => (
                                        <SelectItem key={issue.id} value={issue.id}>
                                            {issue.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={String(state.selectedSortIndex)}
                                onValueChange={(value) => state.selectArticle(Number.parseInt(value, 10))}
                            >
                                <SelectTrigger size="sm" aria-label="选择文章" className="min-w-24 flex-1">
                                    <SelectValue placeholder="文章" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(selectedIssue?.articles ?? []).map((article) => (
                                        <SelectItem key={article.id} value={String(article.sortIndex)}>
                                            {`${String(article.sortIndex)}. ${article.title}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </AppMenu>
                    )}
                </AppHeader>
                <AppContent isScrollable>{renderBody()}</AppContent>
                <AppFooter>
                    <Button variant="outline" onClick={() => void state.reload()}>
                        刷新
                    </Button>
                </AppFooter>
            </AppPage>

            <ConfirmDialog
                open={pendingRemove !== null}
                title="删除留言"
                description={
                    pendingRemove === null
                        ? ''
                        : `将删除这条留言：「${pendingRemove.content.slice(0, 40)}」。删除后读者端也会消失，且无法恢复。`
                }
                confirmLabel="删除"
                isDestructive
                isSubmitting={state.isMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingRemove(null)
                    }
                }}
                onConfirm={() => {
                    const target = pendingRemove
                    setPendingRemove(null)
                    if (target !== null) {
                        void state.remove(target.id)
                    }
                }}
            />
        </>
    )
}
