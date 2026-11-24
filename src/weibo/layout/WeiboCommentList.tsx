/**
 * 评论区：展开时先拉第一页评论，支持继续加载，并在列表上方提供发布 / 回复框。
 * 复用约定：取数（首屏 / 续载 / 子评论展开）走 useWeiboCommentThread，
 * 写操作与加入 AI 对话（发布 / 回复 / 删除 / 添加为上下文）走 useWeiboCommentActions；
 * 发布框与评论条目分别是 CommentComposer / CommentItem，
 * 续载与失败重试交给 LoadMoreSentinel（滚到底自动拉，失败原地重试）；
 * 头像与正文取 WeiboAvatar / WeiboRichText，空态取 StateEmpty、读取失败条取 ListErrorAlert，
 * 删除确认复用公共 AlertDialog。
 * 关键约束：父级条件渲染保证每次展开都是新实例，进入即拉第一页；
 * 游标串行、代际丢弃与写操作单飞都在两个 Hook 内，本组件只做装配与文案；
 * 列表限高滚动，发布框固定在滚动区之外；续载失败保留已加载内容，重试从当前位置继续；
 * 删除入口只给自己的评论：viewerUid 与评论作者 id 相同才渲染，最终归属仍由上游判定。
 */
import { MessageSquare } from 'lucide-react'
import { Spinner } from '@components/ui/spinner'
import { AlertDialog } from '@webview/components/AlertDialog'
import { Button } from '@webview/components/Button'
import { ListErrorAlert } from '@webview/components/ListErrorAlert'
import { LoadMoreSentinel } from '@webview/components/LoadMoreSentinel'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'
import { CommentComposer } from '../block/CommentComposer'
import { CommentItem } from '../block/CommentItem'
import { useWeiboCommentActions } from '../hooks/useWeiboCommentActions'
import { useWeiboCommentThread } from '../hooks/useWeiboCommentThread'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

interface WeiboCommentListProps {
    /** 微博数字 id */
    postId: string
    /** 时间线给出的评论总数：接口未回传时用它兜底展示 */
    totalCount: number
    /** 当前登录账号 uid：与评论作者 id 相同才显示删除入口 */
    viewerUid?: string | null
}

export function WeiboCommentList({ postId, totalCount, viewerUid = null }: WeiboCommentListProps): JSX.Element {
    const thread = useWeiboCommentThread(postId)
    const actions = useWeiboCommentActions({ postId, reload: thread.reload })
    const shownTotal = thread.total ?? totalCount

    return (
        <section className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground text-xs">共 {shownTotal} 条评论</p>

            <CommentComposer
                draft={actions.draft}
                replyTarget={actions.replyTarget}
                shouldRepost={actions.shouldRepost}
                isSubmitting={actions.isSubmitting}
                isDraftValid={actions.isDraftValid}
                onDraftChange={actions.setDraft}
                onShouldRepostChange={actions.setShouldRepost}
                onCancelReply={actions.cancelReply}
                onSubmit={() => {
                    void actions.submit()
                }}
                onKeyDown={actions.handleKeyDown}
            />

            {/* 评论列表限高滚动：超出一屏在块内滚动，不把整张卡片继续拉长 */}
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {thread.isLoading ? (
                    <div className="flex justify-center py-3">
                        <Spinner className="size-4" />
                    </div>
                ) : null}
                {thread.comments.map((comment) => {
                    const canDelete = viewerUid !== null && viewerUid.length > 0 && comment.author.id === viewerUid
                    return (
                        <CommentItem
                            key={comment.id}
                            comment={comment}
                            loadedReplies={thread.expandedReplies[comment.id]}
                            isLoadingReplies={thread.expandingIds.includes(comment.id)}
                            canDelete={canDelete}
                            addingChatIds={actions.addingChatIds}
                            onReply={actions.beginReply}
                            onDelete={() => {
                                actions.requestDelete(comment)
                            }}
                            onLoadReplies={() => {
                                void thread.loadReplies(comment, thread.expandedReplies[comment.id])
                            }}
                            onAddCommentToChat={actions.addCommentToChat}
                            onAddReplyToChat={actions.addReplyToChat}
                        />
                    )
                })}
                {!thread.isLoading && thread.comments.length === 0 && thread.error === null ? (
                    <StateEmpty
                        className="border px-3 py-5"
                        icon={MessageSquare}
                        title={WEIBO_UI_TEXT.empty.comments}
                    />
                ) : null}
                {thread.error === null ? null : (
                    <ListErrorAlert
                        title={WEIBO_UI_TEXT.error.comments}
                        error={thread.error}
                        action={
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                    void thread.reload()
                                }}
                            >
                                {WEIBO_UI_TEXT.action.retry}
                            </Button>
                        }
                    />
                )}
                {/* 哨兵：滚到底部自动续载；续载失败时原地变为「加载失败 + 重试」，游标不动 */}
                {thread.canLoadMore ? (
                    <LoadMoreSentinel
                        sentinelRef={thread.sentinelRef}
                        isLoading={thread.isLoadingMore}
                        hasError={thread.loadMoreError !== null}
                        errorLabel={WEIBO_UI_TEXT.error.moreComments}
                        onRetry={() => {
                            void thread.loadMore()
                        }}
                    />
                ) : null}
            </div>

            {/* 删除确认只有这一个实例：由 pendingDelete 控制，避免每条评论各挂一个弹层 */}
            <AlertDialog
                open={actions.pendingDelete !== null}
                title="删除这条评论？"
                description="删除后不可恢复，原微博下的这条评论会一并消失。"
                confirmLabel={actions.isDestroying ? '正在删除…' : '删除'}
                isDestructive
                isSubmitting={actions.isDestroying}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        actions.cancelDelete()
                    }
                }}
                onConfirm={() => {
                    void actions.confirmDelete()
                }}
            />
        </section>
    )
}
