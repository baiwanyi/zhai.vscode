/**
 * 单条转发：头像在左、「作者名：附言」同行，时间与操作合成一行，整体口径与评论条目一致。
 * 复用约定：正文与表情取 WeiboRichText，头像取 WeiboAvatar，作者名与认证角标取同目录 WeiboAuthorName，
 * 时间与操作行取同目录 RepostActionBar（引用 / 加入对话 / 点赞 / 删除），点赞态由 useWeiboRepostLike 本地持有。
 * 关键约束：删除入口是否渲染由调用方给出的 canDelete 决定，本组件不判当前账号（归属最终由上游判定）；
 * 纯转发没有附言，此时不渲染冒号与正文，只留作者名、时间与操作；
 * 操作只有图标，文案与禁用态都由 tooltip / aria-label 承担，避免与正文抢行。
 */
import type { WeiboRepostItem } from '@shared/types/weibo'
import { RepostActionBar } from './RepostActionBar'
import { WeiboAuthorName } from './WeiboAuthorName'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { JSX } from 'react'
import { useWeiboRepostLike } from '../hooks/useWeiboRepostLike'

export interface RepostItemProps {
    repost: WeiboRepostItem
    canDelete: boolean
    /** 正在加入对话：按钮转圈并禁用点击 */
    isAddingToChat: boolean
    onAddToChat: () => void
    /** 引用这条转发：把作者与附言追加到转发框，由调用方写入草稿 */
    onQuote: () => void
    onDelete: (repost: WeiboRepostItem) => void
}

export function RepostItem({
    repost,
    canDelete,
    isAddingToChat,
    onAddToChat,
    onQuote,
    onDelete,
}: RepostItemProps): JSX.Element {
    /** 附言是否为空：纯转发只留作者与时间，不出现孤零零的冒号 */
    const hasComment = repost.segments.length > 0
    /** 点赞：乐观更新点赞态与计数，失败回滚，状态只活在一条转发内 */
    const like = useWeiboRepostLike(repost)

    /** 删除这条转发：canDelete 为假时不传给操作行，按钮据此不渲染 */
    function handleDelete(): void {
        onDelete(repost)
    }

    return (
        <article className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
            <WeiboAvatar name={repost.author.name} avatarUrl={repost.author.avatarUrl} className="size-7 text-xs" />
            <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center text-xs leading-relaxed">
                    <WeiboAuthorName
                        className="font-medium"
                        name={repost.author.name}
                        isVerified={repost.author.isVerified}
                    />
                    {hasComment ? (
                        <>
                            <span className="text-muted-foreground">：</span>
                            <span className="min-w-0 whitespace-pre-wrap wrap-break-word">
                                <WeiboRichText segments={repost.segments} />
                            </span>
                        </>
                    ) : null}
                </p>
                <RepostActionBar
                    className="mt-1"
                    createdAt={repost.createdAt}
                    createdAtRaw={repost.createdAtRaw}
                    originalLikes={repost.originalLikes}
                    like={like}
                    onQuote={onQuote}
                    isAddingToChat={isAddingToChat}
                    onAddToChat={onAddToChat}
                    onDelete={canDelete ? handleDelete : undefined}
                />
            </div>
        </article>
    )
}
