/**
 * 用户管理内容区：标签列表与用户列表的幂等分发，含加载、错误与筛选空态。
 * 复用约定：标签/用户列表与筛选栏取同目录组件，空态用 Empty，操作失败 Alert 由页面构造并经 actionErrorAlert 注入；
 * 数据取 hook 的 WechatFansState，本组件只负责按状态选择呈现分支。
 * 关键约束：用早返回按 tab → status 逐级收窄，避免嵌套三元；标签选中后由父层切回用户段，
 * 所有写操作回调透传不改签名，写操作期间的禁用态统一由 isMutating 决定。
 */
import { Users } from 'lucide-react'
import type { WechatFanTag } from '@shared/types/wechat'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { WechatFanFilters } from './WechatFanFilters'
import { WechatFanList } from './WechatFanList'
import { WechatTagList } from './WechatTagList'
import type { WechatFansState } from '../../hooks/useWechatFans'
import type { FansTab } from '../types'
import type { JSX, ReactNode } from 'react'

interface WechatFansContentProps {
    tab: FansTab
    state: WechatFansState
    searchDraft: string
    actionErrorAlert?: ReactNode
    onSelectTag: (id: number | null) => void
    onRenameTag: (tag: WechatFanTag) => void
    onRemoveTag: (tag: WechatFanTag) => void
    onKeywordChange: (value: string) => void
    onReload: () => void
}

export function WechatFansContent({
    tab,
    state,
    searchDraft,
    actionErrorAlert,
    onSelectTag,
    onRenameTag,
    onRemoveTag,
    onKeywordChange,
    onReload,
}: WechatFansContentProps): JSX.Element {
    if (tab === 'tags') {
        return (
            <div className="flex w-full flex-col gap-2">
                {actionErrorAlert}
                <WechatTagList
                    tags={state.tags}
                    tagsError={state.tagsError}
                    isMutating={state.isMutating}
                    onSelectTag={onSelectTag}
                    onRename={onRenameTag}
                    onRemove={onRemoveTag}
                />
            </div>
        )
    }

    if (state.status === 'loading') {
        return <Empty className="h-full" title="正在读取用户..." isLoading />
    }

    if (state.status === 'error') {
        return (
            <Empty
                className="h-full"
                icon={Users}
                title="用户列表读取失败"
                description={state.error ?? '请稍后重试'}
            >
                <Button variant="outline" onClick={onReload}>
                    重试
                </Button>
            </Empty>
        )
    }

    return (
        <div className="flex w-full flex-col gap-2">
            {actionErrorAlert}
            <WechatFanFilters
                tags={state.tags}
                tagId={state.tagId}
                statusFilter={state.statusFilter}
                keywordDraft={searchDraft}
                onTagChange={state.setTagId}
                onStatusFilterChange={state.setStatusFilter}
                onKeywordChange={onKeywordChange}
            />
            <WechatFanList
                fans={state.fans}
                tags={state.tags}
                hasFilter={
                    state.keyword.trim().length > 0 || state.tagId !== null || state.statusFilter !== 'all'
                }
                isMutating={state.isMutating}
                onBlacklist={(openid, action) => state.blacklist([openid], action)}
                onRemark={state.remark}
                onToggleTag={(openid, tagId, action) => state.tagMembers([openid], tagId, action)}
            />
        </div>
    )
}
