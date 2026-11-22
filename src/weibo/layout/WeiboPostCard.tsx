/**
 * 时间线卡片：把头部、正文、引用块、底栏与两个按需展开的面板装配成一条微博。
 * 复用约定：头部交给 WeiboPostCardHeader、底栏交给 WeiboPostCardFooter、引用块交给 WeiboRetweetBlock、
 * 媒体区交给 WeiboPostMediaGrid、折叠正文交给 WeiboCollapsibleBody、长文状态交给 WeiboLongTextStatus；
 * 关注、长文与卡片动作各自的请求分别收在 useWeiboAuthorFollow / useWeiboLongText / useWeiboPostActions。
 * 关键约束：本组件只做装配与面板互斥，不直接发写请求、不拼协议字段；长文进入视口才自动取，
 * 主贴与转发体各自独立；评论区与转发列表共用底栏之后的位置且互斥展开；卸载后不再回写、不再弹提示；
 * 「屏蔽该博主」只把作者名交给面板，卡片本身不做隐藏或改写，列表由取数 hook 重新过滤。
 * 面板位置：CardContent 是底栏之前主内容的槽位，展开面板因此收在 CardFooter 之后，
 * 用普通 div 补左右与底部内边距，底部圆角交给 Card 的 overflow-hidden；
 * CardFooter 同时去掉 rounded-b-xl，避免中间露出圆角缺口。
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { Card, CardContent } from '@components/ui/card'
import type { WeiboTimelinePost, WeiboTimelineSegment } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import { useHasEnteredViewport } from '@webview/hooks/useHasEnteredViewport'
import { useIsMounted } from '@webview/hooks/useIsMounted'
import { WeiboCommentList } from './WeiboCommentList'
import { WeiboPostCardFooter } from './WeiboPostCardFooter'
import { WeiboPostCardHeader } from './WeiboPostCardHeader'
import { WeiboRepostList } from './WeiboRepostList'
import { WeiboRetweetBlock } from './WeiboRetweetBlock'
import type { JSX } from 'react'
import { WeiboCollapsibleBody } from '../block/WeiboCollapsibleBody'
import { WeiboLongTextStatus } from '../block/WeiboLongTextStatus'
import { WeiboPostMediaGrid } from '../block/WeiboPostMediaGrid'
import { useWeiboAuthorFollow } from '../hooks/useWeiboAuthorFollow'
import { useWeiboLongText } from '../hooks/useWeiboLongText'
import { useWeiboPostActions } from '../hooks/useWeiboPostActions'

export interface WeiboPostCardProps {
    post: WeiboTimelinePost
    /** 屏蔽该博主：名字交给面板写入屏蔽名单，当前列表随之过滤掉该条 */
    onBlockAuthor?: (authorName: string) => void
    /** 当前登录账号 uid：评论区据此只给自己的评论显示删除入口 */
    viewerUid?: string | null
    /** 隐藏关注入口：个人主页由页头统一提供关注动作，列表卡片不再重复 */
    hideFollow?: boolean
}

/**
 * 卡片用 memo 包一层：草稿 state 在页面层，输入框每敲一个字都会让整棵内容树重渲染，
 * 而本组件的四个 prop 引用都稳定（post 取自列表数组、其余来自 useCallback 或字面量），
 * 不 memo 的话首页每次按键都要重渲染 20–40 张卡片。
 */
export const WeiboPostCard = memo(function WeiboPostCard({
    post,
    onBlockAuthor,
    viewerUid = null,
    hideFollow = false,
}: WeiboPostCardProps): JSX.Element {
    const [isCommentsOpen, setIsCommentsOpen] = useState(false)
    /** 转发列表：与评论区共用底栏之后的位置，两者互斥展开 */
    const [isRepostsOpen, setIsRepostsOpen] = useState(false)

    /** 评论与转发共用 footer 之后的位置：打开一个就收起另一个，避免两张长面板同时展开 */
    const toggleComments = useCallback((): void => {
        setIsCommentsOpen((previous) => !previous)
        setIsRepostsOpen(false)
    }, [])

    const toggleReposts = useCallback((): void => {
        setIsRepostsOpen((previous) => !previous)
        setIsCommentsOpen(false)
    }, [])

    /** 卸载标记：列表刷新会整块替换卡片，打开原文的回包到货时组件可能已卸载，不再弹提示 */
    const isMountedRef = useIsMounted()

    /** 统一的失败提示：卸载后静默丢弃，避免卡片已被替换还冒出一条提示 */
    const reportError = useCallback(
        (cause: unknown): void => {
            if (isMountedRef.current) {
                toastError(cause)
            }
        },
        [isMountedRef],
    )

    const handleOpen = useCallback((): void => {
        void request(WEIBO_METHODS.openPost, { url: post.url }).catch(reportError)
    }, [post.url, reportError])

    const retweeted = post.retweeted
    /** 引用微博的视频封面：打开被转发的原文，而不是当前这条转发 */
    const handleOpenRetweeted = useCallback((): void => {
        if (retweeted === null) {
            return
        }
        void request(WEIBO_METHODS.openPost, { url: retweeted.url }).catch(reportError)
    }, [retweeted, reportError])

    /** 关注态与写操作：按钮与菜单都消费同一份控制器 */
    const follow = useWeiboAuthorFollow(post.author)

    /** 正文进入视口才取全文：一屏几十条长文同时打接口会被上游限流 */
    const { ref: bodyRef, hasEntered: isBodyVisible } = useHasEnteredViewport<HTMLParagraphElement>()
    const bodyLongText = useWeiboLongText(
        post.mblogid.length > 0 ? post.mblogid : post.id,
        post.isLongText,
        isBodyVisible,
    )

    /** 转发体全文：与主贴各自独立，引用块进入视口才取，不拖累主贴的展开节奏 */
    const { ref: retweetedBodyRef, hasEntered: isRetweetedVisible } = useHasEnteredViewport<HTMLQuoteElement>()
    const retweetedLongText = useWeiboLongText(
        retweeted === null ? '' : retweeted.id,
        retweeted !== null && retweeted.isLongText,
        isRetweetedVisible,
    )

    /** 卡片动作：保存到笔记与添加到 AI 对话，主贴与转发已展开的全文都一并带出 */
    const postActions = useWeiboPostActions(post, bodyLongText.fullText, retweetedLongText.fullText)

    /** 正文分段：取到全文后整段替换为接口返回的纯文本，@账号与话题由本地切分出可点链接 */
    const bodySegments = useMemo<WeiboTimelineSegment[]>(
        () => (bodyLongText.fullText === null ? post.segments : splitPlainTextLinks(bodyLongText.fullText)),
        [bodyLongText.fullText, post.segments],
    )
    /** 正文纯文本：只用于判定折叠——全文到货后按全文重判，摘要够短就一直铺开 */
    const bodyText = bodyLongText.fullText ?? post.text

    /** 直链一张都没解析出来但上游声明有图：单独给提示，媒体区自身不再重复 */
    const isImageMissing = post.media.images.length === 0 && post.media.imageCount > 0

    return (
        <Card>
            <WeiboPostCardHeader
                post={post}
                follow={follow}
                hideFollow={hideFollow}
                viewerUid={viewerUid}
                onOpen={handleOpen}
                onBlockAuthor={onBlockAuthor}
            />
            <CardContent className="flex flex-col gap-3">
                <WeiboCollapsibleBody
                    text={bodyText}
                    segments={bodySegments}
                    contentRef={bodyRef}
                    paragraphClassName="text-sm leading-relaxed"
                    fadeClassName="from-card"
                />
                {post.isLongText && bodyLongText.fullText === null ? (
                    <WeiboLongTextStatus
                        isLoading={bodyLongText.isLoading}
                        hasFailed={bodyLongText.hasFailed}
                        onRetry={() => {
                            bodyLongText.requestFullText(true)
                        }}
                    />
                ) : null}

                <WeiboPostMediaGrid media={post.media} onOpenPost={handleOpen} />

                {isImageMissing ? (
                    <p className="text-muted-foreground text-xs">
                        本条含 {post.media.imageCount} 张配图，直链未能解析，请打开原文查看。
                    </p>
                ) : null}

                {retweeted !== null ? (
                    <WeiboRetweetBlock
                        retweeted={retweeted}
                        longText={retweetedLongText}
                        onOpenPost={handleOpenRetweeted}
                        contentRef={retweetedBodyRef}
                    />
                ) : null}
            </CardContent>

            <WeiboPostCardFooter
                post={post}
                actions={postActions}
                isCommentsOpen={isCommentsOpen}
                isRepostsOpen={isRepostsOpen}
                onToggleComments={toggleComments}
                onToggleReposts={toggleReposts}
            />

            {isCommentsOpen ? (
                <div className="px-(--card-spacing) pb-(--card-spacing)">
                    <WeiboCommentList postId={post.id} totalCount={post.metrics.comments} viewerUid={viewerUid} />
                </div>
            ) : null}

            {isRepostsOpen ? (
                <div className="px-(--card-spacing) pb-(--card-spacing)">
                    <WeiboRepostList postId={post.id} totalCount={post.metrics.reposts} viewerUid={viewerUid} />
                </div>
            ) : null}
        </Card>
    )
})
