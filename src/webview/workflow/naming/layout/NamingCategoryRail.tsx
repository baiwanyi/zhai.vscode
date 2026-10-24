/**
 * 取名分类栏：顶部横向的图标 + 文字标签，切换人物 / 地点 / 势力 / 招式 / 装备 / 怪物 / 道具。
 * 复用约定：切换结构取业务公共层的 SegmentedRail（pill 形态），分类清单来自宿主下发的 catalog，
 * 图标取 constants 的 CATEGORY_ICONS，缺项回落到 FALLBACK_ICON。
 * 关键约束：分段项不得用 TooltipTrigger 包裹——Tooltip 注入的 data-state 会覆盖选中态导致高亮失效；
 * catalog 未就绪时不渲染本栏，由页面保证，本组件不做空态分支。
 */
import type { NamingCatalog, NamingCategory } from '@shared/types/naming'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import type { JSX } from 'react'
import { CATEGORY_ICONS, CATEGORY_RAIL_LABEL, FALLBACK_ICON } from '../constants'

interface NamingCategoryRailProps {
    catalog: NamingCatalog
    activeCategory: NamingCategory
    onSelect: (category: NamingCategory) => void
}

export function NamingCategoryRail({ catalog, activeCategory, onSelect }: NamingCategoryRailProps): JSX.Element {
    const items: readonly SegmentedRailItem<NamingCategory>[] = catalog.categories.map((category) => ({
        value: category.value,
        label: category.label,
        icon: CATEGORY_ICONS[category.value] ?? FALLBACK_ICON,
    }))

    return <SegmentedRail items={items} value={activeCategory} onChange={onSelect} ariaLabel={CATEGORY_RAIL_LABEL} />
}
