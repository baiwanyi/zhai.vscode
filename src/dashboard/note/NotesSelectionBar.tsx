/**
 * 笔记多选操作栏：固定于页面底部（不随卡片滚动），承载选中项的置顶切换与批量删除入口。
 * 复用 @components/ui 的 button；选中集合与状态判断由页面下发，组件自身不持有状态。
 * 关键约束：置顶按钮语义随选中项收敛——全部已置顶时呈现「取消置顶」，
 * 点击后整批置为同一状态，故混合选中时统一按「置顶」处理；
 * 两个按钮各自独立、以固定间距分隔，等分底栏宽度（flex-1），不使用 ButtonGroup 拼接。
 */
import { Pin, PinOff, Trash2 } from 'lucide-react'
import { Separator } from '@components/ui/separator'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface NotesSelectionBarProps {
    /** 选中项是否已全部置顶 */
    isAllSelectedPinned: boolean
    onTogglePin: () => void
    onDelete: () => void
}

export function NotesSelectionBar({ isAllSelectedPinned, onTogglePin, onDelete }: NotesSelectionBarProps): JSX.Element {
    return (
        <div className="flex flex-1 items-center gap-2">
            <Button variant="secondary" className="flex-1" onClick={onTogglePin}>
                {isAllSelectedPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {isAllSelectedPinned ? '取消置顶' : '置顶'}
            </Button>
            <Separator orientation="vertical" className="mx-2 my-1 bg-muted" />
            <Button variant="destructive" className="flex-1" onClick={onDelete}>
                <Trash2 className="size-4" />
                删除
            </Button>
        </div>
    )
}
