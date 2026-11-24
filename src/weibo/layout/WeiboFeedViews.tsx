/**
 * 信息流视图：时间线 / 热门频道 / 自建分组 / 我的赞共用一套区块，只差控制器与空态文案。
 * 复用约定：区块取同目录 WeiboFeedSection，凭证与屏蔽入口由页面注入，视图标识由页面解析。
 * 关键约束：时间线缺默认分组、分组结果未到时先给加载态，避免误报「没有内容」；
 * 空态文案固定在本文件，页面不再拼字符串；翻页一律由 feed.loadMore 承担。
 */
import { Inbox } from 'lucide-react'
import type { WeiboCredentialState, WeiboGroupItem } from '@shared/types/weibo'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import { WeiboFeedSection } from './WeiboFeedSection'
import type { WeiboFeedController } from '../hooks/useWeiboFeed'
import type { WeiboContentKind, WeiboFeedSources } from '../utils/weiboFeedRouting'
import type { JSX } from 'react'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 本组件负责的内容种类：首页与热搜页各有自己的视图，不在此列 */
export type WeiboFeedKind = Exclude<WeiboContentKind, 'home' | 'hotRank'>

export interface WeiboFeedViewsProps {
    kind: WeiboFeedKind
    feeds: WeiboFeedSources
    isConfigured: boolean
    /** 默认分组的 list_id：为空且已配置时提示重新读取分组 */
    timelineListId: string | null
    activeGroup: WeiboGroupItem | null
    credential: WeiboCredentialState | null
    credentialErrorCode: string | null
    credentialErrorMessage: string | null
    groupsLoading: boolean
    groupsErrorMessage: string | null
    onReloadGroups: () => void
    onBlockAuthor: (authorName: string) => void
    viewerUid: string | null
    onRefresh: () => void
    onOpenSettings: () => void
}

export function WeiboFeedViews({
    kind,
    feeds,
    isConfigured,
    timelineListId,
    activeGroup,
    credential,
    credentialErrorCode,
    credentialErrorMessage,
    groupsLoading,
    groupsErrorMessage,
    onReloadGroups,
    onBlockAuthor,
    viewerUid,
    onRefresh,
    onOpenSettings,
}: WeiboFeedViewsProps): JSX.Element {
    /** 四个视图共用同一套区块：只差控制器与两条空态文案 */
    function renderSection(feed: WeiboFeedController, emptyTitle: string, emptyDescription: string): JSX.Element {
        return (
            <WeiboFeedSection
                feed={feed}
                credential={credential}
                credentialErrorCode={credentialErrorCode}
                credentialErrorMessage={credentialErrorMessage}
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
                onBlockAuthor={onBlockAuthor}
                viewerUid={viewerUid}
                onRefresh={onRefresh}
                onOpenSettings={onOpenSettings}
            />
        )
    }

    if (kind === 'timeline') {
        if (isConfigured && timelineListId === null) {
            if (groupsLoading) {
                return <StateEmpty className="py-8" title={WEIBO_UI_TEXT.loading.defaultGroup} isLoading />
            }
            return (
                <StateEmpty
                    className="py-8"
                    icon={Inbox}
                    title={WEIBO_UI_TEXT.error.group}
                    description={groupsErrorMessage ?? '默认分组决定时间线的 list_id：刷新分组后再试。'}
                >
                    <Button size="sm" variant="outline" onClick={onReloadGroups}>
                        {WEIBO_UI_TEXT.action.reloadGroups}
                    </Button>
                </StateEmpty>
            )
        }
        return renderSection(feeds.timeline, WEIBO_UI_TEXT.empty.timeline, '默认分组近期没有更新，稍后刷新一次再试。')
    }

    if (kind === 'hotFeed') {
        return renderSection(feeds.hot, WEIBO_UI_TEXT.empty.hot, '推荐频道暂时返回空页，稍后刷新一次再试。')
    }

    if (kind === 'likes') {
        return renderSection(feeds.likes, WEIBO_UI_TEXT.empty.likes, '在微博里点过赞的内容会按时间倒序出现在这里。')
    }

    if (isConfigured && groupsLoading && activeGroup === null) {
        return <StateEmpty className="py-8" title={WEIBO_UI_TEXT.loading.groups} isLoading />
    }
    return renderSection(
        feeds.group,
        `「${activeGroup?.title ?? '该分组'}」没有内容`,
        '分组近期没有更新，稍后刷新一次再试。',
    )
}
