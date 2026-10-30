/**
 * 仪表盘底部操作栏：置于 AppPage 的 AppFooter，左端「添加」按钮与右端「更多操作」浮层分列两侧。
 * 浮层以本文件内的组件函数承载索引重建、缓存清理与插件设置入口，交互全部经回调上抛给页面。
 * 关键约束：浮层菜单项须置于 DropdownMenuGroup 内，破坏性操作单独分组并使用 destructive 变体。
 */
import { Ellipsis, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface DashboardFooterActionsProps {
    isBusy: boolean
    isRebuilding: boolean
    onAdd: () => void
    onRebuild: () => void
    onClearCache: () => void
    onOpenSettings: () => void
}

interface MoreMenuProps {
    isBusy: boolean
    isRebuilding: boolean
    onRebuild: () => void
    onClearCache: () => void
    onOpenSettings: () => void
}

function MoreMenu({ isBusy, isRebuilding, onRebuild, onClearCache, onOpenSettings }: MoreMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={isBusy} tooltip="更多操作" aria-label="更多操作">
                    <Ellipsis />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={isBusy || isRebuilding} onSelect={onRebuild}>
                        {isRebuilding ? <Spinner /> : <RefreshCw />}
                        {isRebuilding ? '重建中…' : '重建索引'}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" disabled={isBusy} onSelect={onClearCache}>
                        <Trash2 />
                        清空缓存
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isBusy} onSelect={onOpenSettings}>
                        <Settings />
                        插件设置
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function DashboardFooterActions({
    isBusy,
    isRebuilding,
    onAdd,
    onRebuild,
    onClearCache,
    onOpenSettings,
}: DashboardFooterActionsProps): JSX.Element {
    return (
        <div className="flex flex-1 items-center justify-between pt-3">
            <Button size="icon" variant="primary" disabled={isBusy} tooltip="添加笔记" onClick={onAdd}>
                <Plus />
            </Button>
            <MoreMenu
                isBusy={isBusy}
                isRebuilding={isRebuilding}
                onRebuild={onRebuild}
                onClearCache={onClearCache}
                onOpenSettings={onOpenSettings}
            />
        </div>
    )
}
