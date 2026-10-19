/**
 * 取名分类栏：顶部横向的图标 + 文字标签，切换人物 / 地点 / 势力 / 招式 / 装备 / 怪物 / 道具。
 * 复用约定：图标取自 lucide-react，切换复用 ui/toggle-group（单选横向）；选项自带文字，不再叠加 Tooltip。
 * 关键约束：当前分类以主色块高亮（`data-[state=on]`）；不能再用 TooltipTrigger 包裹分段项——
 * Tooltip 会向子节点注入自身的 `data-state`，覆盖 ToggleGroup 的选中态导致高亮失效。
 */
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { NamingCatalog, NamingCategory } from '@shared/types/naming'
import type { JSX } from 'react'
import { CATEGORY_ICONS, CATEGORY_RAIL_LABEL, FALLBACK_ICON } from '../constants'

interface NamingCategoryRailProps {
    catalog: NamingCatalog
    activeCategory: NamingCategory
    onSelect: (category: NamingCategory) => void
}

export function NamingCategoryRail({ catalog, activeCategory, onSelect }: NamingCategoryRailProps): JSX.Element {
    return (
        <ToggleGroup
            type="single"
            spacing={1}
            value={activeCategory}
            onValueChange={(value) => {
                if (value) {
                    onSelect(value as NamingCategory)
                }
            }}
            aria-label={CATEGORY_RAIL_LABEL}
            className="w-full flex-wrap rounded-lg bg-muted p-1"
        >
            {catalog.categories.map((category) => {
                const Icon = CATEGORY_ICONS[category.value] ?? FALLBACK_ICON
                return (
                    <ToggleGroupItem
                        key={category.value}
                        value={category.value}
                        aria-label={category.label}
                        className="h-8 gap-1 px-2 text-muted-foreground text-xs transition-colors hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground"
                    >
                        <Icon className="size-4" />
                        {category.label}
                    </ToggleGroupItem>
                )
            })}
        </ToggleGroup>
    )
}
