/**
 * 仪表盘顶部操作区：全宽「添加」按钮与右侧更多操作按钮，构成同高的胶囊控件组。
 * 组合同目录 DashboardQuickMenu 承载索引维护与设置入口，交互全部经回调上抛给页面。
 * 关键约束：两个控件共用 outline 变体与全圆角，避免同类入口出现两套形态。
 */
import { Plus } from 'lucide-react'
import { Button } from '@components/ui/button'
import { DashboardQuickMenu } from './DashboardQuickMenu'
import type { JSX } from 'react'

interface DashboardTopBarProps {
    isBusy: boolean
    isRebuilding: boolean
    onAdd: () => void
    onRebuild: () => void
    onClearCache: () => void
    onOpenSettings: () => void
}

export function DashboardTopBar({
    isBusy,
    isRebuilding,
    onAdd,
    onRebuild,
    onClearCache,
    onOpenSettings,
}: DashboardTopBarProps): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            <Button variant="outline" size="lg" className="flex-1 justify-start rounded-full" onClick={onAdd}>
                <Plus data-icon="inline-start" />
                添加
            </Button>
            <DashboardQuickMenu
                isBusy={isBusy}
                isRebuilding={isRebuilding}
                onRebuild={onRebuild}
                onClearCache={onClearCache}
                onOpenSettings={onOpenSettings}
            />
        </div>
    )
}
