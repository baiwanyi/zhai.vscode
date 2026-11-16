/**
 * 笔记模块的共享展示元数据：置顶开关的文案与图标随当前状态翻转，多处入口共用一份口径。
 * 复用 lucide 的 Pin / PinOff，只提供元数据不渲染 JSX，图标尺寸由调用方按场景给。
 * 关键约束：聚合态（如多选栏的「全部已置顶」）由调用方先算出布尔值再取用，本文件不判断集合语义。
 */
import { Pin, PinOff, type LucideIcon } from 'lucide-react'

/** 置顶开关的文案与图标 */
export interface PinToggleMeta {
    label: string
    icon: LucideIcon
}

/** 置顶开关：已置顶时呈现「取消置顶」+ PinOff，否则「置顶」+ Pin */
export function getPinToggleMeta(isPinned: boolean): PinToggleMeta {
    return isPinned ? { label: '取消置顶', icon: PinOff } : { label: '置顶', icon: Pin }
}
