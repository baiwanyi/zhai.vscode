/**
 * 提示词分类栏：垂直单选列表，一级分类与二级分组共用同一套结构。
 * 复用约定：ToggleGroup 取 @components/ui/toggle-group，计数徽标取 @webview/blocks/Badge；
 * 提示词面板（AiChatPromptPicker）的两级分类共用本组件，样式差异由调用方从 ../utils/prompt/styles 取值传入。
 * 关键约束：Radix 允许再点一次已选项回传空串，这里直接丢弃，保证始终有一项生效；
 * 栏体宽高、底色与滚动都交给 className，本层不预设视觉，避免面板各处覆盖；
 * 本文件只导出组件，样式常量与分类回落函数分居 ../utils/prompt/styles 与 ../utils/prompt/library。
 */
import { cn } from 'cn'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { Badge } from '@webview/blocks/Badge'
import type { PromptCategoryRailItem } from '../utils/prompt/library'
import type { JSX } from 'react'

interface PromptCategoryRailProps {
    /** 读屏用的分类层级名：一级与二级各一条 */
    ariaLabel: string
    items: readonly PromptCategoryRailItem[]
    /** 当前生效项：由面板按「旧值不在列表里即回落首项」算好传入 */
    value: string
    /** 栏体宽高、底色与滚动：两级各有一套视觉 */
    className: string
    /** 选中态配色：一级用主色，二级用次级色 */
    itemClassName: string
    onSelect: (name: string) => void
}

export function PromptCategoryRail({
    ariaLabel,
    items,
    value,
    className,
    itemClassName,
    onSelect,
}: PromptCategoryRailProps): JSX.Element {
    /** Radix 允许再点一次已选项回传空串：丢弃空值，让当前项始终保持选中 */
    function handleValueChange(next: string): void {
        if (next.length > 0) {
            onSelect(next)
        }
    }

    return (
        <ToggleGroup
            type="single"
            orientation="vertical"
            spacing={0.5}
            value={value}
            aria-label={ariaLabel}
            className={className}
            onValueChange={handleValueChange}
        >
            {items.map((item) => (
                <ToggleGroupItem
                    key={item.name}
                    value={item.name}
                    className={cn('justify-between gap-1 text-muted-foreground', itemClassName)}
                >
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.count === undefined ? null : <Badge variant="secondary">{item.count}</Badge>}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    )
}
