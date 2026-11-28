/**
 * 留言管理页组装层：只装配数据 Hook、交互 Hook 与四块布局，不再自持交互状态。
 * 复用约定：数据取 useWechatComments，筛选 / 详情 / 回复 / 待删状态与动作取 useWechatCommentInteraction；
 * 外壳取 AppPage，页头 / 筛选 / 列表 / 详情 / 确认分别取 layout/ 下独立组件，交互动作统一以 actions 下发。
 * 关键约束：页面不直接调用写操作，也不拼装业务文案——状态切换的清场与草稿归属判定都在交互 Hook 内；
 * 详情与确认弹窗不互相叠加，由交互 Hook 保证先收起详情再弹确认。
 */
import type { WechatAccountSummary } from '@shared/types/wechat'
import { AppContent, AppPage } from '@webview/components/AppPage'
import { useWechatCommentInteraction } from './hooks/useWechatCommentInteraction'
import { WechatCommentDetailDialog } from './layout/WechatCommentDetailDialog'
import { WechatCommentFilters } from './layout/WechatCommentFilters'
import { WechatCommentHeader } from './layout/WechatCommentHeader'
import { WechatCommentList } from './layout/WechatCommentList'
import { WechatCommentRemoveDialog } from './layout/WechatCommentRemoveDialog'
import type { JSX } from 'react'
import { useWechatComments } from '../hooks/useWechatComments'

interface WechatCommentPageProps {
    account: WechatAccountSummary
}

export function WechatCommentPage({ account }: WechatCommentPageProps): JSX.Element {
    const state = useWechatComments(account.id)
    const view = useWechatCommentInteraction(account.name, state)

    return (
        <>
            <AppPage>
                <WechatCommentHeader
                    description={view.description}
                    issues={state.issues}
                    selectedIssueId={state.selectedIssueId}
                    selectedSortIndex={state.selectedSortIndex}
                    actions={view.actions}
                />
                <AppContent isScrollable>
                    {state.issues.length === 0 ? null : (
                        <WechatCommentFilters
                            filter={view.filter}
                            counts={view.counts}
                            loaded={state.comments.length}
                            total={state.total}
                            isCommentEnabled={view.isCommentEnabled}
                            isMutating={state.isMutating && state.mutatingCommentId === null}
                            actions={view.actions}
                        />
                    )}
                    <WechatCommentList
                        comments={view.visibleComments}
                        loadedCount={state.comments.length}
                        filter={view.filter}
                        total={state.total}
                        status={state.status}
                        error={state.error}
                        hasIssue={state.issues.length > 0}
                        hasMore={view.hasMore}
                        isLoadingMore={state.isLoadingMore}
                        sentinelRef={view.sentinelRef}
                        isMutating={state.isMutating}
                        mutatingCommentId={state.mutatingCommentId}
                        replyDraft={view.replyDraft}
                        actions={view.actions}
                    />
                </AppContent>
            </AppPage>

            <WechatCommentDetailDialog
                comment={view.detailComment}
                articleLabel={view.articleLabel}
                canOpenArticle={view.canOpenArticle}
                isMutating={state.isMutating}
                replyDraft={view.detailReplyDraft}
                actions={view.actions}
            />

            <WechatCommentRemoveDialog
                comment={view.pendingRemove}
                isSubmitting={state.isMutating}
                actions={view.actions}
            />
        </>
    )
}
