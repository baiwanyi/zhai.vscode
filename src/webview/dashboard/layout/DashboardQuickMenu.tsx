/**
 * 顶部更多操作浮层：以省略号按钮展开索引重建、缓存清理与插件设置。
 * 复用 @components/ui 的 dropdown-menu 与 spinner；动作经回调上抛，自身不持有状态。
 * 关键约束：菜单项须置于 DropdownMenuGroup 内，破坏性操作单独分组并使用 destructive 变体。
 */
import { Ellipsis, RefreshCw, Settings, Trash2 } from 'lucide-react'
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

interface DashboardQuickMenuProps {
    isBusy: boolean
    isRebuilding: boolean
    onRebuild: () => void
    onClearCache: () => void
    onOpenSettings: () => void
}

export function DashboardQuickMenu({
    isBusy,
    isRebuilding,
    onRebuild,
    onClearCache,
    onOpenSettings,
}: DashboardQuickMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    disabled={isBusy}
                    tooltip="更多操作"
                    aria-label="更多操作"
                >
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
