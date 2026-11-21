/**
 * 信息流分区：把「凭证门 + 加载态 + 列表 + 空态」收成一处，时间线/热门/分组/我的赞共用。
 * 复用约定：列表与空态交给同目录 WeiboFeedList，凭证占位交给 CredentialGate；
 * 页面只给 feed 控制器与两条空态文案，不再各自拼加载态与翻页回调。
 * 关键约束：isLoading 必须并入 hasLoaded，否则首帧会先闪一下空态；
 * 翻页一律走 feed.loadMore，页面不再包一层 void 回调；有取数错误时空态优先展示错误。
 */
import type { WeiboCredentialState } from '@shared/types/weibo'
import { CredentialGate } from './CredentialGate'
import { WeiboFeedList } from './WeiboFeedList'
import type { WeiboFeedController } from '../hooks/useWeiboFeed'
import type { JSX, ReactNode } from 'react'

interface WeiboFeedSectionProps {
    /** 该视图的信息流控制器：列表、加载态与翻页都从它读 */
    feed: WeiboFeedController
    credential: WeiboCredentialState | null
    credentialErrorCode: string | null
    credentialErrorMessage: string | null
    emptyTitle: string
    /** 空态兜底文案：有取数错误时优先展示错误 */
    emptyDescription: string
    /** 空态覆盖：需要自定义空态（如带刷新按钮）时传入 */
    emptyState?: ReactNode
    /** 屏蔽该博主：原样透传给列表里的卡片「更多」菜单 */
    onBlockAuthor?: (authorName: string) => void
    /** 当前登录账号 uid：原样透传，评论区据此只给自己的评论显示删除 */
    viewerUid?: string | null
    onRefresh: () => void
    onOpenSettings: () => void
}

/** 信息流分区：未配置凭证时只给占位，其余情况统一渲染列表与空态 */
export function WeiboFeedSection({
    feed,
    credential,
    credentialErrorCode,
    credentialErrorMessage,
    emptyTitle,
    emptyDescription,
    emptyState,
    onBlockAuthor,
    viewerUid = null,
    onRefresh,
    onOpenSettings,
}: WeiboFeedSectionProps): JSX.Element {
    if (credential?.isConfigured !== true) {
        return (
            <CredentialGate
                credential={credential}
                errorCode={credentialErrorCode}
                errorMessage={credentialErrorMessage}
                onOpenSettings={onOpenSettings}
            />
        )
    }
    return (
        <WeiboFeedList
            posts={feed.state.posts}
            isLoading={feed.state.isLoading || !feed.state.hasLoaded}
            isLoadingMore={feed.state.isLoadingMore}
            hasMore={feed.state.hasMore}
            emptyTitle={emptyTitle}
            emptyDescription={feed.state.errorMessage ?? emptyDescription}
            emptyState={emptyState}
            errorMessage={feed.state.errorMessage}
            onBlockAuthor={onBlockAuthor}
            viewerUid={viewerUid}
            onRefresh={onRefresh}
            onLoadMore={() => {
                void feed.loadMore()
            }}
        />
    )
}
