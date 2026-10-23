/**
 * 设定分组栏：顶部横向的图标 + 文字标签，切换「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格」。
 * 复用约定：文案与图标取自 sections 表，切换复用 ui/toggle-group（单选横向）；标签自带文字，不再叠加 Tooltip。
 * 关键约束：当前分组以主色块高亮（`data-[state=on]`），不得用 TooltipTrigger 包裹分段项——
 * Tooltip 会向子节点注入自身的 `data-state`，覆盖 ToggleGroup 的选中态导致高亮失效。
 */
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { SETTING_SECTION_ORDER, SETTING_SECTIONS } from './sections'
import type { SettingSectionKey } from './sections'
import type { JSX } from 'react'

interface PressSettingRailProps {
    activeSection: SettingSectionKey
    onSelect: (section: SettingSectionKey) => void
}

export function PressSettingRail({ activeSection, onSelect }: PressSettingRailProps): JSX.Element {
    return (
        <ToggleGroup
            type="single"
            spacing={1}
            value={activeSection}
            onValueChange={(value) => {
                if (value.length > 0) {
                    onSelect(value as SettingSectionKey)
                }
            }}
            aria-label="设定分组"
            className="w-full flex-wrap rounded-lg bg-muted p-1"
        >
            {SETTING_SECTION_ORDER.map((key) => {
                const meta = SETTING_SECTIONS[key]
                const Icon = meta.icon
                return (
                    <ToggleGroupItem
                        key={key}
                        value={key}
                        aria-label={meta.label}
                        className="h-8 gap-1 px-2 text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground"
                    >
                        <Icon className="size-4" />
                        {meta.label}
                    </ToggleGroupItem>
                )
            })}
        </ToggleGroup>
    )
}
