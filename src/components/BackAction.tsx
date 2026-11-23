/**
 * 返回动作：标题行左侧的单个返回按钮，图标 + 文案（aria-label 与 tooltip 共用），自带 AppAction 槽位。
 * 复用约定：仪表盘按路由推导落点、工作流历史页按页内视图回退，两者只共用这一层外观与可达性约定；
 * 默认图标与仪表盘一致（左箭头），回概览首页这类入口可传自定义图标。
 * 关键约束：本组件只回答「按钮长什么样 + 点击后做什么」，不推导路由、不持有状态；
 * AppAction 槽位必须保留 —— AppHeader 的 start 三列网格靠它把按钮定位到左右两列。
 */
import { ChevronLeft } from 'lucide-react'
import { AppAction } from './AppPage'
import { Button } from './Button'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 按钮外观：仪表盘用 secondary，工作流面板与标题行其它按钮同为 ghost */
export type BackActionVariant = 'secondary' | 'ghost'

export interface BackActionProps {
    /** 返回文案：同时用作 aria-label 与 tooltip，调用方负责写清去向（如「返回对话」） */
    label: string
    onClick: () => void
    /** 图标，缺省为左箭头 */
    icon?: LucideIcon
    /** 按钮外观，缺省为 secondary（与仪表盘各页一致） */
    variant?: BackActionVariant
}

export function BackAction({
    label,
    onClick,
    icon: Icon = ChevronLeft,
    variant = 'secondary',
}: BackActionProps): JSX.Element {
    return (
        <AppAction>
            <Button variant={variant} size="icon" aria-label={label} tooltip={label} onClick={onClick}>
                <Icon />
            </Button>
        </AppAction>
    )
}
