/**
 * 单条评论：主评论头像在左、名称与正文同行（flex 行内垂直居中），时间与操作合成一行；
 * 子评论无头像、操作悬停显示。
 * 复用约定：正文取 WeiboRichText，头像取 WeiboAvatar，作者名与认证角标取 WeiboAuthorName，
 * 时间与操作行取同目录 CommentActionBar（时间格式化在组件内），子评论用同文件的 CommentReplyItem。
 * 关键约束：删除入口是否渲染由调用方给出的 canDelete 决定，归属最终由上游判定；
 * 子评论默认只铺开 3 条，预览不足时自动补一页且每条只补一次，加载中由 Button 转圈；
 * 回复与加入对话只回调触发、不拼协议字段，在途态由 addingChatIds 与 isLoading 表达；
 * 点赞态与计数由 useWeiboCommentLike 本地持有，不回写列表数据源。
 */
import { ChevronsDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isWeiboTimelineId } from '@shared/types/weibo'
import type { WeiboCommentItem, WeiboCommentReply } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { readWeiboAuthorName } from '@webview/weibo/utils/weiboAuthor'
import { buildProfileNameUrl, buildProfileUrl } from '@webview/weibo/utils/weiboLinks'
import { CommentActionBar } from './CommentActionBar'
import { WeiboAuthorName } from './WeiboAuthorName'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboLink, WeiboRichText } from './WeiboRichText'
import type { CommentReplyTarget } from '../hooks/useWeiboCommentActions'
import type { ExpandedReplies } from '../hooks/useWeiboCommentThread'
import type { JSX } from 'react'
import { useWeiboCommentLike } from '../hooks/useWeiboCommentLike'

export interface CommentItemProps {
    comment: WeiboCommentItem
    /** 该评论已展开的回复：undefined 表示还没展开过，直接用随列表下发的预览 */
    loadedReplies: ExpandedReplies | undefined
    isLoadingReplies: boolean
    canDelete: boolean
    /** 正在加入对话的评论 id：命中时该条按钮禁用并换文案 */
    addingChatIds: readonly string[]
    onReply: (target: CommentReplyTarget) => void
    onDelete: () => void
    onLoadReplies: () => void
    onAddCommentToChat: (comment: WeiboCommentItem) => void
    onAddReplyToChat: (reply: WeiboCommentReply) => void
}

/** 默认展示的子评论条数：上游预览不足时自动补一页，但初次只铺开这么多 */
const DEFAULT_VISIBLE_REPLIES = 3

interface CommentReplyItemProps {
    reply: WeiboCommentReply
    isAddingToChat: boolean
    onReply: () => void
    onAddToChat: () => void
}

/** 子评论行：名称、回复关系与正文同行，时间与操作在第二行，操作项悬停该条才显示 */
function CommentReplyItem({ reply, isAddingToChat, onReply, onAddToChat }: CommentReplyItemProps): JSX.Element {
    /** 点赞：与一级评论同一套乐观更新，状态只活在这一行 */
    const like = useWeiboCommentLike(reply)

    return (
        <div className="group">
            <p className="flex flex-wrap items-center text-xs leading-relaxed">
                <WeiboAuthorName
                    className="font-medium"
                    name={reply.author.name}
                    isVerified={reply.author.isVerified}
                />
                <span className="text-muted-foreground">：</span>
                {reply.replyToName.length > 0 ? (
                    <>
                        <span className="text-muted-foreground">回复</span>
                        <WeiboLink
                            text={`@${reply.replyToName}`}
                            // 有合法数字 uid 用 uid 版（改名后仍能定位），否则退回昵称版；
                            // 与主贴头部、引用块同一守卫，避免拼出 /u/非数字 的空地址
                            url={
                                isWeiboTimelineId(reply.replyToUid)
                                    ? buildProfileUrl(reply.replyToUid)
                                    : buildProfileNameUrl(reply.replyToName)
                            }
                        />
                        <span className="text-muted-foreground">：</span>
                    </>
                ) : null}
                <span className="min-w-0 whitespace-pre-wrap wrap-break-word">
                    <WeiboRichText segments={reply.segments} />
                </span>
            </p>
            <CommentActionBar
                className="mt-0.5"
                createdAt={reply.createdAt}
                createdAtRaw={reply.createdAtRaw}
                like={like}
                isAddingToChat={isAddingToChat}
                replyLabel={readWeiboAuthorName(reply.author.name)}
                onReply={onReply}
                onAddToChat={onAddToChat}
                isHoverReveal
            />
        </div>
    )
}

export function CommentItem({
    comment,
    loadedReplies,
    isLoadingReplies,
    canDelete,
    addingChatIds,
    onReply,
    onDelete,
    onLoadReplies,
    onAddCommentToChat,
    onAddReplyToChat,
}: CommentItemProps): JSX.Element {
    const authorName = readWeiboAuthorName(comment.author.name)
    /** 已拿到的全部回复：展开过就用宿主回包，否则用随列表下发的预览 */
    const allReplies = loadedReplies?.replies ?? comment.replies
    /** 是否已点过「展开」：未点之前只铺开前 3 条，避免补拉一页后把卡片整块撑高 */
    const [isRepliesExpanded, setIsRepliesExpanded] = useState(false)
    /** 自动补足的占位：每条评论只补一次，失败后不再重试 */
    const hasAutoLoadedRef = useRef(false)
    const visibleReplies = isRepliesExpanded ? allReplies : allReplies.slice(0, DEFAULT_VISIBLE_REPLIES)
    const remainingReplies = Math.max(0, comment.replyCount - visibleReplies.length)
    const canLoadMoreReplies = remainingReplies > 0 && (loadedReplies === undefined || loadedReplies.maxId !== null)
    /** 已加载但被默认条数压住的回复：此时即便没有更多页，展开入口仍要出现 */
    const hasHiddenReplies = allReplies.length > visibleReplies.length
    /** 本条评论是否正在加入对话：按钮据此转圈并禁用点击 */
    const isAddingChat = addingChatIds.includes(comment.id)
    /** 点赞：乐观更新点赞态与计数，失败回滚，状态只活在本行 */
    const like = useWeiboCommentLike(comment)

    /**
     * 默认展示 3 条：上游只下发 1–2 条预览时补拉一页，把默认可见条数补齐。
     * 关键约束：每条评论只自动补一次（ref 判定），失败不再重试，避免打开评论区时请求连发；
     * 补拉结果仍按默认条数截断，用户点「展开」才铺开。
     */
    useEffect(() => {
        if (hasAutoLoadedRef.current || isLoadingReplies || loadedReplies !== undefined) {
            return
        }
        if (comment.replies.length >= DEFAULT_VISIBLE_REPLIES || comment.replyCount <= comment.replies.length) {
            return
        }
        hasAutoLoadedRef.current = true
        onLoadReplies()
    }, [comment.replies.length, comment.replyCount, isLoadingReplies, loadedReplies, onLoadReplies])

    return (
        <article className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
            <WeiboAvatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} className="size-7 text-xs" />
            <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center text-xs leading-relaxed">
                    <WeiboAuthorName
                        className="font-medium"
                        name={comment.author.name}
                        isVerified={comment.author.isVerified}
                    />
                    <span className="text-muted-foreground">：</span>
                    <span className="min-w-0 whitespace-pre-wrap wrap-break-word">
                        <WeiboRichText segments={comment.segments} />
                    </span>
                </p>
                <CommentActionBar
                    className="mt-1"
                    createdAt={comment.createdAt}
                    createdAtRaw={comment.createdAtRaw}
                    like={like}
                    isAddingToChat={isAddingChat}
                    onDelete={canDelete ? onDelete : undefined}
                    replyLabel={authorName}
                    onReply={() => {
                        onReply({ id: comment.id, authorName })
                    }}
                    onAddToChat={() => {
                        onAddCommentToChat(comment)
                    }}
                />

                {visibleReplies.length > 0 || canLoadMoreReplies || hasHiddenReplies ? (
                    <div className="mt-1 flex flex-col gap-1.5 border-l-2 border-border/60 pl-2">
                        {visibleReplies.map((reply) => (
                            <CommentReplyItem
                                key={reply.id}
                                reply={reply}
                                isAddingToChat={addingChatIds.includes(reply.id)}
                                onReply={() => {
                                    onReply({ id: reply.id, authorName: readWeiboAuthorName(reply.author.name) })
                                }}
                                onAddToChat={() => {
                                    onAddReplyToChat(reply)
                                }}
                            />
                        ))}
                        {canLoadMoreReplies || hasHiddenReplies ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="gap-1 self-start text-link hover:text-link/80"
                                isLoading={isLoadingReplies}
                                onClick={() => {
                                    setIsRepliesExpanded(true)
                                    // 还有没拉过的回复才发请求；只是被默认条数压住时点一次即可铺开
                                    if (canLoadMoreReplies) {
                                        onLoadReplies()
                                    }
                                }}
                            >
                                {/* 括量是「尚未铺开」的条数，不是总数：写「共 N 条」会让用户以为总共只有 N 条 */}
                                {`展开剩余 ${String(remainingReplies)} 条回复`}
                                <ChevronsDown />
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </article>
    )
}
