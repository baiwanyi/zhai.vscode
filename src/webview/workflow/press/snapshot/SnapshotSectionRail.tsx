/**
 * 快照分区栏：顶部横向的图标 + 文字标签，切换「设定与大纲」与「章节正文」两条时间线。
 * 复用约定：图标取自 lucide-react，切换复用 ui/toggle-group（单选横向），与取名页分类栏同一形态；选项自带文字，不再叠加 Tooltip。
 * 关键约束：当前分区以主色块高亮（`data-[state=on]`）；不可用 TooltipTrigger 包裹分段项——
 * Tooltip 会向子节点注入自身的 `data-state`，覆盖 ToggleGroup 的选中态导致高亮失效。
 */
import { BookOpen, FileText } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { JSX } from 'react'

/** 快照页的两个分区：结构化文档整版快照与章节正文时间线 */
export type SnapshotSection = 'doc' | 'chapter'

interface SnapshotSectionItem {
    value: SnapshotSection
    label: string
    icon: typeof FileText
}

/** 分区清单：顺序即展示顺序，设定在前是因为它对应创作时的第一步 */
const SNAPSHOT_SECTIONS: readonly SnapshotSectionItem[] = [
    { value: 'doc', label: '设定与大纲', icon: FileText },
    { value: 'chapter', label: '章节正文', icon: BookOpen },
]

interface SnapshotSectionRailProps {
    activeSection: SnapshotSection
    onSelect: (section: SnapshotSection) => void
}

export function SnapshotSectionRail({ activeSection, onSelect }: SnapshotSectionRailProps): JSX.Element {
    return (
        <ToggleGroup
            type="single"
            spacing={1}
            value={activeSection}
            onValueChange={(value) => {
                if (value) {
                    onSelect(value as SnapshotSection)
                }
            }}
            aria-label="快照分区"
            className="w-full flex-wrap rounded-lg bg-muted p-1"
        >
            {SNAPSHOT_SECTIONS.map((item) => {
                const Icon = item.icon
                return (
                    <ToggleGroupItem
                        key={item.value}
                        value={item.value}
                        aria-label={item.label}
                        className="h-8 gap-1 px-2 text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground"
                    >
                        <Icon className="size-4" />
                        {item.label}
                    </ToggleGroupItem>
                )
            })}
        </ToggleGroup>
    )
}
