/**
 * 首页内容：凭证卡（未配置时）/ 发布框 + 关注时间线列表。
 * 复用约定：凭证卡、发布框与列表分别取同目录 CredentialCard / ComposerCard / WeiboFeedList，
 * 未配置时的引导取 CredentialGate；凭证失败文案由 utils/weiboViewDescription 统一给出。
 * 关键约束：列表空态的「刷新」与顶栏刷新是同一动作；未配置时列表空态换成获取 Cookie 的引导；
 * 发布草稿与已选图片由页面持有，本组件只透传，不自行请求。
 */
import { Inbox } from 'lucide-react'
import type { UploadFileItem } from '@shared/types/upload'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import { ComposerCard } from './ComposerCard'
import { CredentialCard } from './CredentialCard'
import { CredentialGate } from './CredentialGate'
import { WeiboFeedList } from './WeiboFeedList'
import type { WeiboTimelineController } from '../hooks/useWeiboTimeline'
import type { JSX } from 'react'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'
import { readCredentialNotice } from '../utils/weiboViewDescription'

export interface WeiboHomeViewProps {
    isConfigured: boolean
    homeState: WeiboTimelineController['state']
    draft: string
    images: UploadFileItem[]
    onDraftChange: (value: string) => void
    onImagesChange: (images: UploadFileItem[]) => void
    onPublished: (post: WeiboTimelinePost | null) => void
    onBlockAuthor: (authorName: string) => void
    viewerUid: string | null
    onRefresh: () => void
    onLoadMore: () => void
    onSaveCredential: (cookie: string) => Promise<boolean>
    onOpenSettings: () => void
}

export function WeiboHomeView({
    isConfigured,
    homeState,
    draft,
    images,
    onDraftChange,
    onImagesChange,
    onPublished,
    onBlockAuthor,
    viewerUid,
    onRefresh,
    onLoadMore,
    onSaveCredential,
    onOpenSettings,
}: WeiboHomeViewProps): JSX.Element {
    const shouldShowCredential = !homeState.isLoading && !isConfigured

    return (
        <>
            {shouldShowCredential ? (
                <CredentialCard
                    isSaving={homeState.isSavingCredential}
                    errorMessage={readCredentialNotice(homeState.errorCode, homeState.errorMessage)}
                    onSave={onSaveCredential}
                />
            ) : (
                <ComposerCard
                    isEnabled={isConfigured}
                    draft={draft}
                    onDraftChange={onDraftChange}
                    images={images}
                    onImagesChange={onImagesChange}
                    onPublished={onPublished}
                />
            )}

            <WeiboFeedList
                posts={homeState.posts}
                isLoading={homeState.isLoading}
                isLoadingMore={homeState.isLoadingMore}
                hasMore={homeState.hasMore}
                errorMessage={homeState.errorMessage}
                emptyState={
                    isConfigured ? (
                        <StateEmpty
                            className="py-8"
                            icon={Inbox}
                            // 自定义空态绕过了 WeiboFeedList 的错误标题判断，这里自己补：有取数错误就不能说「没有内容」
                            title={
                                homeState.errorMessage === null
                                    ? WEIBO_UI_TEXT.empty.timeline
                                    : WEIBO_UI_TEXT.error.feed
                            }
                            description={
                                homeState.errorMessage ??
                                '可能是关注列表近期没有更新，也可能是接口返回了空页：稍后刷新一次再试。'
                            }
                        >
                            <Button size="sm" variant="outline" onClick={onRefresh}>
                                {WEIBO_UI_TEXT.action.refresh}
                            </Button>
                        </StateEmpty>
                    ) : (
                        <CredentialGate
                            variant="hint"
                            credential={homeState.credential}
                            errorCode={homeState.errorCode}
                            errorMessage={homeState.errorMessage}
                            onOpenSettings={onOpenSettings}
                        />
                    )
                }
                onBlockAuthor={onBlockAuthor}
                viewerUid={viewerUid}
                onLoadMore={onLoadMore}
            />
        </>
    )
}
