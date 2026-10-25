/**
 * 设定分组栏：顶部横向的图标 + 文字标签，切换「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格 / 封面」。
 * 复用约定：切换结构取业务公共层的 SegmentedRail（pill 形态），文案与图标取自 sections 表，
 * 本组件只做「元数据表 → 分段项」的一次映射，不再重复实现容器与选中态样式。
 * 关键约束：分段项不得用 TooltipTrigger 包裹——Tooltip 会注入自身 data-state 覆盖选中态导致高亮失效，
 * 该约束与高亮样式已由 SegmentedRail 统一承担；sections 表新增分组时本文件无需改动。
 */
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import { SETTING_SECTION_ORDER, SETTING_SECTIONS } from './sections'
import type { SettingSectionKey } from './sections'
import type { JSX } from 'react'

interface PressSettingRailProps {
    activeSection: SettingSectionKey
    onSelect: (section: SettingSectionKey) => void
}

/** 分段项只在模块加载时构建一次，避免每次渲染重建数组 */
const SECTION_ITEMS: readonly SegmentedRailItem<SettingSectionKey>[] = SETTING_SECTION_ORDER.map((key) => ({
    value: key,
    label: SETTING_SECTIONS[key].label,
    icon: SETTING_SECTIONS[key].icon,
}))

export function PressSettingRail({ activeSection, onSelect }: PressSettingRailProps): JSX.Element {
    return <SegmentedRail items={SECTION_ITEMS} value={activeSection} onChange={onSelect} ariaLabel="设定分组" />
}
