/**
 * 笔记多选操作栏：固定于页面底部（不随卡片滚动），承载选中项的置顶切换与批量删除入口。
 * 复用 @webview/components/Button 承载两侧按钮；选中集合与状态判断由页面下发，组件自身不持有状态。
 * 关键约束：置顶按钮语义随选中项收敛——全部已置顶时呈现「取消置顶」，
 * 点击后整批置为同一状态，故混合选中时统一按「置顶」处理；
 * 两个按钮各自独立、以固定间距分隔，等分底栏宽度（flex-1），不使用 ButtonGroup 拼接。
 */
import { Trash2 } from 'lucide-react'
import { Separator } from '@components/ui/separator'
import { Button } from '@webview/components/Button'
import { getPinToggleMeta } from './constants'
import type { JSX } from 'react'

interface NotesSelectionBarProps {
    /** 选中项是否已全部置顶 */
    isAllSelectedPinned: boolean
    /** 有操作在途时禁用两个入口：单一 pendingAction 无法表达并发，重复提交会让忙碌态提前解锁 */
    isBusy: boolean
    onTogglePin: () => void
    onDelete: () => void
}

export function NotesSelectionBar({
    isAllSelectedPinned,
    isBusy,
    onTogglePin,
    onDelete,
}: NotesSelectionBarProps): JSX.Element {
    const pinToggle = getPinToggleMeta(isAllSelectedPinned)
    const PinToggleIcon = pinToggle.icon

    return (
        <div className="flex flex-1 items-center gap-2">
            <Button variant="secondary" className="flex-1" disabled={isBusy} onClick={onTogglePin}>
                <PinToggleIcon className="size-4" />
                {pinToggle.label}
            </Button>
            <Separator orientation="vertical" className="mx-2 my-1 bg-muted" />
            <Button variant="destructive" className="flex-1" disabled={isBusy} onClick={onDelete}>
                <Trash2 className="size-4" />
                删除
            </Button>
        </div>
    )
}
