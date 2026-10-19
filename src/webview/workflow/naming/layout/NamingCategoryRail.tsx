/**
 * 取名分类栏：左侧纵向图标列表，切换人物 / 地点 / 势力 / 招式 / 装备 / 怪物 / 道具。
 * 复用约定：图标取自 lucide-react，按钮复用 ui/toggle-group（单选竖排），悬浮名称复用 ui/tooltip。
 * 关键约束：纯图标按钮必须带可访问名称；分类清单以宿主 catalog 为准，前端不硬编码顺序。
 */
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { NamingCatalog, NamingCategory } from '@/shared/types/naming'
import type { JSX } from 'react'
import { CATEGORY_ICONS, CATEGORY_RAIL_LABEL, FALLBACK_ICON } from '../constants'

interface NamingCategoryRailProps {
    catalog: NamingCatalog
    activeCategory: NamingCategory
    onSelect: (category: NamingCategory) => void
}

export function NamingCategoryRail({ catalog, activeCategory, onSelect }: NamingCategoryRailProps): JSX.Element {
    return (
        <TooltipProvider>
            <ToggleGroup
                type="single"
                orientation="vertical"
                spacing={1}
                value={activeCategory}
                onValueChange={(value) => {
                    if (value) {
                        onSelect(value as NamingCategory)
                    }
                }}
                aria-label={CATEGORY_RAIL_LABEL}
                className="w-12 shrink-0 rounded-lg bg-activity-bar p-1"
            >
                {catalog.categories.map((category) => {
                    const Icon = CATEGORY_ICONS[category.value] ?? FALLBACK_ICON
                    return (
                        <Tooltip key={category.value}>
                            <TooltipTrigger asChild>
                                <ToggleGroupItem
                                    value={category.value}
                                    aria-label={category.label}
                                    className="size-10 text-activity-bar-inactive-foreground data-[state=on]:bg-activity-bar-active-background data-[state=on]:text-activity-bar-foreground"
                                >
                                    <Icon className="size-5" />
                                </ToggleGroupItem>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-(length:--font-size-ui)">
                                {category.label}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}
            </ToggleGroup>
        </TooltipProvider>
    )
}
