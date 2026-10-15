/**
 * 笔记多选操作栏：固定于页面底部（不随卡片滚动），承载选中项的置顶切换与批量删除入口。
 * 复用 @/components/ui 的 button 与 separator；选中集合与状态判断由页面下发，组件自身不持有状态。
 * 关键约束：置顶按钮语义随选中项收敛——全部已置顶时呈现「取消置顶」，
 * 点击后整批置为同一状态，故混合选中时统一按「置顶」处理。
 */
import { Pin, PinOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { JSX } from 'react'

interface NotesSelectionBarProps {
    /** 选中项是否已全部置顶 */
    isAllSelectedPinned: boolean
    onTogglePin: () => void
    onDelete: () => void
}

export function NotesSelectionBar({ isAllSelectedPinned, onTogglePin, onDelete }: NotesSelectionBarProps): JSX.Element {
    return (
        <div className="flex items-center justify-center gap-1">
            <Button size="sm" variant="ghost" className="rounded-full" onClick={onTogglePin}>
                {isAllSelectedPinned ? <PinOff /> : <Pin />}
                {isAllSelectedPinned ? '取消置顶' : '置顶'}
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-destructive hover:text-destructive"
                onClick={onDelete}
            >
                <Trash2 />
                删除
            </Button>
        </div>
    )
}
