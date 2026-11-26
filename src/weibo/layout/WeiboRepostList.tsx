/**
 * 转发面板：读取谁转发了这条微博（页码分页），并在列表上方提供转发框。
 * 复用约定：取数（首屏 / 续载 / 总数）走 useWeiboReposts，写操作（转发 / 删除 / 引用 / 加入对话）
 * 走 useWeiboRepostActions；转发框与条目分别是 RepostComposer / RepostItem，
 * 续载与失败重试交给 LoadMoreSentinel（滚到底自动拉，失败原地重试）；
 * 空态取 Empty、读取失败条取 Alert，删除确认复用公共 AlertDialog。
 * 关键约束：父级条件渲染保证每次展开都是新实例，进入即拉第一页；
 * 页码串行、代际丢弃、写操作单飞都在两个 Hook 内，本组件只做装配与文案；
 * 列表限高滚动；删除入口只给自己的转发：viewerUid 与转发作者 id 相同才渲染，最终归属仍由上游判定。
 */
import { Repeat2 } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@components/ui/spinner'
import { toErrorDetail } from '@shared/utils/error'
import { Empty } from '@webview/blocks/Empty'
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { Alert } from '@webview/components/Alert'
import { AlertDialog } from '@webview/components/AlertDialog'
import type { JSX } from 'react'
import { RepostComposer } from '../block/RepostComposer'
import { RepostItem } from '../block/RepostItem'
import { useWeiboRepostActions } from '../hooks/useWeiboRepostActions'
import { useWeiboReposts } from '../hooks/useWeiboReposts'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

interface WeiboRepostListProps {
    /** 微博数字 id */
    postId: string
    /** 时间线给出的转发总数：接口未回传时用它兜底展示 */
    totalCount: number
    /** 当前登录账号 uid：与转发作者 id 相同才显示删除入口 */
    viewerUid?: string | null
}

export function WeiboRepostList({ postId, totalCount, viewerUid = null }: WeiboRepostListProps): JSX.Element {
    const thread = useWeiboReposts(postId, totalCount)
    const actions = useWeiboRepostActions({
        postId,
        reload: thread.reload,
        onCommitted: thread.adjustCount,
        onDeleted: thread.removeLocal,
    })
    /** 引用信号：每引用一次 +1，转发框据此聚焦并把光标放到引用内容之后 */
    const [quoteSignal, setQuoteSignal] = useState(0)

    return (
        <section className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground text-xs">共 {thread.shownTotal} 次转发</p>

            <RepostComposer
                draft={actions.draft}
                shouldComment={actions.shouldComment}
                draftLimit={actions.draftLimit}
                isDraftOverLimit={actions.isDraftOverLimit}
                isSubmitting={actions.isSubmitting}
                focusEndSignal={quoteSignal}
                onDraftChange={actions.setDraft}
                onShouldCommentChange={actions.setShouldComment}
                onKeyDown={actions.handleKeyDown}
                onSubmit={() => {
                    void actions.submit()
                }}
            />

            {/* 转发列表限高滚动：超出一屏在块内滚动，不把整张卡片继续拉长 */}
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {thread.isLoading ? (
                    <div className="flex justify-center py-3">
                        <Spinner className="size-4" />
                    </div>
                ) : null}
                {thread.reposts.map((repost) => (
                    <RepostItem
                        key={repost.id}
                        repost={repost}
                        canDelete={viewerUid !== null && viewerUid.length > 0 && repost.author.id === viewerUid}
                        isAddingToChat={actions.addingChatIds.includes(repost.id)}
                        onAddToChat={() => {
                            actions.addRepostToChat(repost)
                        }}
                        onQuote={() => {
                            actions.quoteRepost(repost)
                            setQuoteSignal((previous) => previous + 1)
                        }}
                        onDelete={actions.requestDelete}
                    />
                ))}
                {!thread.isLoading && thread.reposts.length === 0 && thread.error === null ? (
                    <Empty className="border px-3 py-5" icon={Repeat2} title={WEIBO_UI_TEXT.empty.reposts} />
                ) : null}
                {thread.error === null ? null : (
                    <Alert
                        title={WEIBO_UI_TEXT.error.reposts}
                        description={toErrorDetail(thread.error)}
                        variant="destructive"
                        callback={(): void => { void thread.reload() }}
                        actionText={WEIBO_UI_TEXT.action.retry}
                        actionStatus="outline"
                    />
                )}
                {/* 哨兵：滚到底部自动续载；续载失败时原地变为「加载失败 + 重试」，页码不动 */}
                {thread.canLoadMore ? (
                    <LoadMoreSentinel
                        sentinelRef={thread.sentinelRef}
                        isLoading={thread.isLoadingMore}
                        hasError={thread.loadMoreError !== null}
                        errorLabel={WEIBO_UI_TEXT.error.moreReposts}
                        onRetry={() => {
                            void thread.loadMore()
                        }}
                    />
                ) : null}
            </div>

            {/* 删除确认只有这一个实例：由 pendingDelete 控制，避免每条转发各挂一个弹层 */}
            <AlertDialog
                open={actions.pendingDelete !== null}
                title="删除这条转发？"
                description="删除后不可恢复，原微博下自己的这条转发会一并消失。"
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
