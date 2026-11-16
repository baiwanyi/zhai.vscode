/**
 * 笔记列表标题行操作：常态提供进入多选，多选态只提供退出。
 * 复用 @webview/components/Button 承载图标入口（悬停提示由该组件提供）；
 * 搜索框已常驻页面头部，本组件不再承载搜索入口，只保留多选开关。
 * 关键约束：多选态只渲染退出按钮，避免两个模式的操作相互干扰；
 * 搜索框文案由页面从本文件取用 SEARCH_LABEL，避免占位与可读名两处措辞漂移。
 */
import { ListChecks, X } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 搜索框文案：输入框占位与可读名共用，避免两处措辞漂移 */
export const SEARCH_LABEL = '搜索笔记'

interface NotesHeaderActionsProps {
    isSelecting: boolean
    onToggleSelecting: () => void
}

export function NotesHeaderActions({ isSelecting, onToggleSelecting }: NotesHeaderActionsProps): JSX.Element {
    if (isSelecting) {
        return (
            <Button
                variant="secondary"
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
