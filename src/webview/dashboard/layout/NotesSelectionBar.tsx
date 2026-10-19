/**
 * 笔记多选操作栏：固定于页面底部（不随卡片滚动），承载选中项的置顶切换与批量删除入口。
 * 复用 @components/ui 的 button 与 button-group；选中集合与状态判断由页面下发，组件自身不持有状态。
 * 关键约束：置顶按钮语义随选中项收敛——全部已置顶时呈现「取消置顶」，
 * 点击后整批置为同一状态，故混合选中时统一按「置顶」处理；
 * 组内分隔须用 ButtonGroupSeparator，禁止手写边框模拟；两个按钮等分底栏宽度（flex-1）。
 */
import { Pin, PinOff, Trash2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@components/ui/button-group'
import type { JSX } from 'react'

interface NotesSelectionBarProps {
    /** 选中项是否已全部置顶 */
    isAllSelectedPinned: boolean
    onTogglePin: () => void
    onDelete: () => void
}

export function NotesSelectionBar({ isAllSelectedPinned, onTogglePin, onDelete }: NotesSelectionBarProps): JSX.Element {
    return (
        <ButtonGroup className="relative w-full">
            <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-b form-transparent to-background border-b border-muted" />
            <Button size="default" variant="ghost" className="h-9 flex-1 text-foreground" onClick={onTogglePin}>
                {isAllSelectedPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {isAllSelectedPinned ? '取消置顶' : '置顶'}
            </Button>
            <ButtonGroupSeparator className="self-center! h-5!" />
            <Button
                size="default"
                variant="ghost"
                className="h-9 flex-1 text-destructive hover:text-destructive"
                onClick={onDelete}
            >
                <Trash2 className="size-4" />
                删除
            </Button>
        </ButtonGroup>
    )
}
