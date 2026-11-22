/**
 * 卡片底栏：左侧转发 / 评论 / 点赞三项等分（WeiboMetricButton 统一外观），右侧两个卡片动作图标。
 * 复用约定：展开态与点击由卡片注入，点赞的乐观更新在 WeiboPostLikeButton 内，动作请求在 useWeiboPostActions 内；
 * 本组件只负责排布与互斥禁用，不发请求、不持有业务状态；左侧三项不挂悬停提示，语义由 aria-label 承担。
 * 关键约束：两个动作互斥禁用——任一请求进行中两者都不可点，避免并发写盘与并发改上下文。
 */
import { Check, MessageCircle, MessageSquareShare, NotebookDot, Repeat2 } from 'lucide-react'
import { CardFooter } from '@components/ui/card'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import type { WeiboPostActionController } from '@webview/weibo/hooks/useWeiboPostActions'
import type { JSX } from 'react'
import { WeiboMetricButton } from '../block/WeiboMetricButton'
import { WeiboPostLikeButton } from '../block/WeiboPostLikeButton'

export interface WeiboPostCardFooterProps {
    post: WeiboTimelinePost
    /** 保存到笔记 / 添加到 AI 对话的控制器 */
    actions: WeiboPostActionController
    isCommentsOpen: boolean
    isRepostsOpen: boolean
    onToggleComments: () => void
    onToggleReposts: () => void
}

export function WeiboPostCardFooter({
    post,
    actions,
    isCommentsOpen,
    isRepostsOpen,
    onToggleComments,
    onToggleReposts,
}: WeiboPostCardFooterProps): JSX.Element {
    /** 底栏两个动作只有图标：进行态与「已保存」回执靠 tooltip 与图标变化表达 */
    const saveNoteHint = actions.isSavedNote ? '已保存到笔记' : actions.isSavingNote ? '正在保存…' : '保存到笔记'
    const addToChatHint = actions.isAddingToChat ? '正在添加到对话…' : '添加到 AI 对话'

    return (
        <CardFooter className="rounded-none border-0 bg-transparent py-2 text-muted-foreground">
            {/* 转发 / 评论 / 点赞各占三分之一、内容左对齐：常态灰字无底，悬停或激活才上色并浮出圆形色块 */}
            <div className="flex flex-1 items-center">
                <WeiboMetricButton
                    icon={<Repeat2 className="size-4" aria-hidden="true" />}
                    count={post.metrics.reposts}
                    ariaLabel={`转发 ${String(post.metrics.reposts)}`}
                    isActive={isRepostsOpen}
                    tone="emerald"
                    ariaExpanded={isRepostsOpen}
                    onClick={onToggleReposts}
                />
                <WeiboMetricButton
                    icon={<MessageCircle className="size-4" aria-hidden="true" />}
                    count={post.metrics.comments}
                    ariaLabel={`评论 ${String(post.metrics.comments)}`}
                    isActive={isCommentsOpen}
                    tone="sky"
                    ariaExpanded={isCommentsOpen}
                    onClick={onToggleComments}
                />
                {/* key 跟随上游点赞态：上游数据变化时只重建按钮、把 initialLiked 重新喂进去，
                    卡片本身（展开的评论区、已取的长文）不再跟着重挂载 */}
                <WeiboPostLikeButton
                    key={post.isLiked ? 'liked' : 'unliked'}
                    postId={post.id}
                    initialLiked={post.isLiked}
                    initialCount={post.metrics.likes}
                    className="flex-1 justify-start"
                />
            </div>

            {/* 两个卡片动作落在底栏右侧：只有图标，进行态与「已保存」回执靠 tooltip 与图标变化表达；
                互斥禁用——任一请求进行中两者都不可点，避免并发写盘与并发改上下文 */}
            <div className="flex shrink-0 items-center gap-1 pl-1">
                {/* 进行中的那一个也要禁用：控制器虽有 ref 串行化，连点只会被静默丢弃，且图标不变看不出在跑 */}
                <Button
                    variant="ghost"
                    size="icon"
                    tooltip={saveNoteHint}
                    aria-label={saveNoteHint}
                    isLoading={actions.isSavingNote}
                    disabled={actions.isSavingNote || actions.isAddingToChat}
                    onClick={actions.saveToNote}
                >
                    {actions.isSavedNote ? <Check /> : <NotebookDot />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    tooltip={addToChatHint}
                    aria-label={addToChatHint}
                    isLoading={actions.isAddingToChat}
                    disabled={actions.isSavingNote || actions.isAddingToChat}
                    onClick={actions.addToChat}
                >
                    <MessageSquareShare />
                </Button>
            </div>
        </CardFooter>
    )
}
