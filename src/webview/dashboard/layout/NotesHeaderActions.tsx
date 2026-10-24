/**
 * 笔记列表标题行操作：非多选态提供进入多选，多选态只提供退出。
 * 复用 @webview/components/Button；独立图标按钮用 icon 尺寸，提示经 tooltip 参数给出。
 * 状态经回调上抛，组件自身不持有。
 * 关键约束：多选态只渲染退出按钮，避免两个模式的操作相互干扰。
 */
import { ListChecks, X } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface NotesHeaderActionsProps {
    isSelecting: boolean
    onToggleSelecting: () => void
}

export function NotesHeaderActions({ isSelecting, onToggleSelecting }: NotesHeaderActionsProps): JSX.Element {
    if (isSelecting) {
        return (
            <Button
                variant="destructive"
                size="icon"
                aria-label="退出多选"
                tooltip="退出多选"
                onClick={onToggleSelecting}
            >
                <X />
            </Button>
        )
    }

    return (
        <Button variant="ghost" size="icon" aria-label="多选" tooltip="多选" onClick={onToggleSelecting}>
            <ListChecks />
        </Button>
    )
}
