/**
 * 选中文本浮动菜单：当前可用「复制」，马克笔 / 批注 / 查询留作后续阶段的入口占位。
 * 复用约定：浮层用 shadcn Popover（锚点是零尺寸 fixed 元素），按钮用 src/components 的 Button，
 * 复制走 @shared/utils/clipboard；选区与坐标全部来自 useSelectionToolbar。
 * 关键约束：点按钮必须阻止默认行为，否则 webview 失焦会让选区塌陷、复制内容变空；
 * 未实现的入口保持禁用并标注「即将支持」，不做点击无反应的假交互。
 */
import { Check, Copy, Highlighter, MessageSquareText, Search } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { copyToClipboard } from '@shared/utils/clipboard'
import { Button } from '@webview/components/Button'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'
import { useSelectionToolbar } from '../hooks/useSelectionToolbar'

/** 复制成功提示的停留时长 */
const COPIED_HINT_MS = 1200

export interface SelectionToolbarProps {
    editor: Editor | null
}

export function SelectionToolbar({ editor }: SelectionToolbarProps): JSX.Element | null {
    const { isOpen, left, top, text, dismiss } = useSelectionToolbar(editor)
    const [isCopied, setIsCopied] = useState(false)

    if (!isOpen || editor === null) {
        return null
    }

    const handleCopy = async (): Promise<void> => {
        const isOk = await copyToClipboard(text)
        setIsCopied(isOk)
        window.setTimeout((): void => {
            setIsCopied(false)
        }, COPIED_HINT_MS)
    }

    return (
        <Popover
            open
            onOpenChange={(nextOpen): void => {
                if (!nextOpen) {
                    dismiss()
                }
            }}
        >
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={{ left, top }} />
            </PopoverAnchor>
            <PopoverContent
                side="top"
                align="center"
                className="w-auto p-1"
                onOpenAutoFocus={(event): void => {
                    event.preventDefault()
                }}
                onMouseDown={(event): void => {
                    event.preventDefault()
                }}
            >
                <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="sm" onClick={(): void => void handleCopy()}>
                        {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {isCopied ? '已复制' : '复制'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled>
                        <Highlighter className="size-3.5" />
                        马克笔
                    </Button>
                    <Button variant="ghost" size="sm" disabled>
                        <MessageSquareText className="size-3.5" />
                        批注
                    </Button>
                    <Button variant="ghost" size="sm" disabled>
                        <Search className="size-3.5" />
                        查询
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
