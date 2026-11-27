/**
 * 用户管理页头：标题、刷新/新建/同步操作、描述与分段切换。
 * 复用约定：外壳取 AppPage 的 Header 族组件，图标按钮统一用 @webview/components/Button 的 tooltip 与 aria-label；
 * 分段选项与收窄函数在本组件内定义，对外只暴露 FansTab 联合类型。
 * 关键约束：标签段提供新建入口、用户段提供同步入口且同步期间显示加载态；两个图标按钮都必须带 aria-label，
 * 分段值来自宿主通用字符串，先收窄为 FansTab 再上抛。
 */
import { CloudBackup, RefreshCw, TagPlus } from 'lucide-react'
import { AppAction, AppDescription, AppHeader, AppMenu, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { FansTab } from '../types'
import type { JSX } from 'react'

/** 分段选项：同步是按钮操作而非页面 */
const TAB_OPTIONS: readonly { value: FansTab; label: string }[] = [
    { value: 'fans', label: '用户' },
    { value: 'tags', label: '标签' },
]

/** 收窄分段值 */
function readTab(value: string): FansTab {
    return value === 'tags' ? value : 'fans'
}

interface WechatFansHeaderProps {
    tab: FansTab
    description: string
    isMutating: boolean
    isSyncing: boolean
    onReload: () => void
    onCreateTag: () => void
    onSync: () => void
    onTabChange: (tab: FansTab) => void
}

export function WechatFansHeader({
    tab,
    description,
    isMutating,
    isSyncing,
    onReload,
    onCreateTag,
    onSync,
    onTabChange,
}: WechatFansHeaderProps): JSX.Element {
    return (
        <AppHeader>
            <AppTitle>用户管理</AppTitle>
            <AppAction>
                <Button variant="ghost" size="icon" aria-label="刷新" tooltip="刷新" onClick={onReload}>
                    <RefreshCw className="size-3.5" />
                </Button>
                {tab === 'tags' ? (
                    <Button
                        size="icon"
                        aria-label="新建标签"
                        tooltip="新建标签"
                        disabled={isMutating}
                        onClick={onCreateTag}
                    >
                        <TagPlus className="size-3.5" />
                    </Button>
                ) : (
                    <Button size="icon" aria-label="同步用户" tooltip="同步用户" isLoading={isSyncing} onClick={onSync}>
                        <CloudBackup className="size-3.5" />
                    </Button>
                )}
            </AppAction>
            <AppDescription>{description}</AppDescription>
            <AppMenu>
                <SegmentedRail
                    items={TAB_OPTIONS}
                    value={tab}
                    onChange={(value) => onTabChange(readTab(value))}
                    ariaLabel="用户管理分段"
                    variant="outline"
                    size="sm"
                />
            </AppMenu>
        </AppHeader>
    )
}
