/**
 * 快照分区栏：顶部横向的图标 + 文字标签，切换「设定与大纲」与「章节正文」两条时间线。
 * 复用约定：切换结构取业务公共层的 SegmentedRail（pill 形态），分区清单仍在本地常量维护，
 * 与设定分组栏、取名分类栏同一形态，差异只在数据源。
 * 关键约束：分区顺序即展示顺序（设定在前对应创作第一步）；不可用 TooltipTrigger 包裹分段项，
 * 否则 Tooltip 注入的 data-state 会覆盖 ToggleGroup 选中态导致高亮失效。
 */
import { BookOpen, FileText } from 'lucide-react'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import type { JSX } from 'react'

/** 快照页的两个分区：结构化文档整版快照与章节正文时间线 */
export type SnapshotSection = 'doc' | 'chapter'

/** 分区清单：顺序即展示顺序，设定在前是因为它对应创作时的第一步 */
const SNAPSHOT_SECTIONS: readonly SegmentedRailItem<SnapshotSection>[] = [
    { value: 'doc', label: '设定与大纲', icon: FileText },
    { value: 'chapter', label: '章节正文', icon: BookOpen },
]

interface SnapshotSectionRailProps {
    activeSection: SnapshotSection
    onSelect: (section: SnapshotSection) => void
}

export function SnapshotSectionRail({ activeSection, onSelect }: SnapshotSectionRailProps): JSX.Element {
    return <SegmentedRail items={SNAPSHOT_SECTIONS} value={activeSection} onChange={onSelect} ariaLabel="快照分区" />
}
