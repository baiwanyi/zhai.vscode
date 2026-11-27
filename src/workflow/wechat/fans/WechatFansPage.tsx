/**
 * 用户管理页组装层：持有分段与搜索草稿，绑定同步命令，分发标签编辑命令。
 * 复用约定：数据取 useWechatFans、同步命令取 useWechatFansSync，页头与内容区分取 layout/ 下独立组件；
 * 页头描述取 utils/pageText，标签编辑状态由弹窗组件内部持有，页面仅通过 ref 命令触发。
 * 关键约束：搜索防抖只在页面保留一份，子组件重挂载不打断输入结算；切换账号由页面 key 重挂载；
 * 操作错误条挂在内容区上方，标签与用户两段共用；本文件不承载列表渲染与状态判定逻辑。
 */
import { useRef, useState } from 'react'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { Alert } from '@webview/components/Alert'
import { AppContent, AppPage } from '@webview/components/AppPage'
import { useDebouncedCallback } from '@webview/hooks/useDebouncedCallback'
import { WechatFansContent } from './layout/WechatFansContent'
import { WechatFansHeader } from './layout/WechatFansHeader'
import { WechatTagEditDialog } from './layout/WechatTagEditDialog'
import { readPageDescription } from './utils/pageText'
import type { WechatTagEditorHandle } from './layout/WechatTagEditDialog'
import type { FansTab } from './types'
import type { JSX } from 'react'
import { useWechatFans } from '../hooks/useWechatFans'
import { useWechatFansSync } from '../hooks/useWechatFansSync'

/** 搜索输入到下发筛选的防抖间隔 */
const SEARCH_DEBOUNCE_MS = 300

interface WechatFansPageProps {
    account: WechatAccountSummary
}

export function WechatFansPage({ account }: WechatFansPageProps): JSX.Element {
    const state = useWechatFans(account.id)
    const { sync, isSyncing } = useWechatFansSync(state)
    const [tab, setTab] = useState<FansTab>('fans')
    const [searchDraft, setSearchDraft] = useState('')
    const tagEditorRef = useRef<WechatTagEditorHandle>(null)

    // 防抖只在父层保留一份：子组件重挂载不会打断输入结算
    const submitKeyword = useDebouncedCallback((value: string) => state.setKeyword(value), SEARCH_DEBOUNCE_MS)

    const handleSelectTag = (id: number | null): void => {
        state.setTagId(id)
        setTab('fans')
    }

    const handleKeywordChange = (value: string): void => {
        setSearchDraft(value)
        submitKeyword(value)
    }

    const description = readPageDescription(account.name, tab, state)
    const actionErrorAlert =
        state.actionError === null ? undefined : (
            <Alert
                className="mb-2"
                title="操作失败"
                description={state.actionError}
                variant="destructive"
                actionText="关闭"
                callback={state.clearActionError}
            />
        )

    return (
        <AppPage>
            <WechatFansHeader
                tab={tab}
                description={description}
                isMutating={state.isMutating}
                isSyncing={isSyncing}
                onReload={() => void state.reload()}
                onCreateTag={() => tagEditorRef.current?.openForCreate()}
                onSync={() => void sync()}
                onTabChange={setTab}
            />
            <AppContent isScrollable>
                <WechatFansContent
                    tab={tab}
                    state={state}
                    searchDraft={searchDraft}
                    actionErrorAlert={actionErrorAlert}
                    onSelectTag={handleSelectTag}
                    onRenameTag={(tag) => tagEditorRef.current?.openForRename(tag)}
                    onRemoveTag={(tag) => tagEditorRef.current?.requestRemove(tag)}
                    onKeywordChange={handleKeywordChange}
                    onReload={() => void state.reload()}
                />
            </AppContent>
            <WechatTagEditDialog
                ref={tagEditorRef}
                isMutating={state.isMutating}
                onCreate={state.createTag}
                onRename={state.renameTag}
                onRemove={state.removeTag}
            />
        </AppPage>
    )
}
