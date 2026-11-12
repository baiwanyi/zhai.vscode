/**
 * 选中文本浮动菜单：复制、马克笔（含 5 色色板）、批注与查询入口。
 * 复用约定：浮层用 shadcn Popover（锚点为零尺寸 fixed 元素），按钮用 src/components 的 Button，
 * 复制走 @shared/utils/clipboard，划线动作由调用方注入（useAnnotations 统一处理落库与装饰）。
 * 关键约束：点按钮必须阻止默认行为，否则 webview 失焦会让选区塌陷、复制内容变空；
 * 色板展开在同一浮层内完成，不嵌套第二个 Popover——嵌套 Portal 会抢焦点并丢选区。
 */
import { Check, Copy, Highlighter, MessageSquareText, Search } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import type { HighlightColor } from '@shared/types/editor'
import { copyToClipboard } from '@shared/utils/clipboard'
import { Button } from '@webview/components/Button'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'
import { useSelectionToolbar } from '../hooks/useSelectionToolbar'

/** 复制成功提示的停留时长 */
const COPIED_HINT_MS = 1200

/** 色板颜色：与装饰层共用同一枚举，顺序即展示顺序 */
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['coral', 'violet', 'blue', 'emerald', 'amber']

/** 色板圆点颜色：比装饰底色更实，便于辨认 */
const SWATCH_COLORS: Readonly<Record<HighlightColor, string>> = {
    coral: 'rgb(255, 138, 128)',
    violet: 'rgb(186, 140, 255)',
    blue: 'rgb(120, 170, 255)',
    emerald: 'rgb(110, 220, 170)',
    amber: 'rgb(255, 205, 120)',
}

export interface SelectionToolbarProps {
    editor: Editor | null
    /** 划线：同一位置已有划线时取消，由调用方实现 toggle */
    onHighlight: (color: HighlightColor) => Promise<void>
}

export function SelectionToolbar({ editor, onHighlight }: SelectionToolbarProps): JSX.Element | null {
    const { isOpen, left, top, text, dismiss } = useSelectionToolbar(editor)
    const [isCopied, setIsCopied] = useState(false)
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)

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

    const handleHighlight = (color: HighlightColor): void => {
        setIsPaletteOpen(false)
        void onHighlight(color)
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
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={isPaletteOpen}
                        onClick={(): void => {
                            setIsPaletteOpen((previous) => !previous)
                        }}
                    >
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
                {isPaletteOpen ? (
                    <div className="mt-1 flex items-center justify-center gap-1 border-t pt-1">
                        {HIGHLIGHT_COLORS.map((color) => (
                            <Button
                                key={color}
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`划线 ${color}`}
                                onClick={(): void => {
                                    handleHighlight(color)
                                }}
                            >
                                <span
                                    className="size-3.5 rounded-full"
                                    style={{ backgroundColor: SWATCH_COLORS[color] }}
                                />
                            </Button>
                        ))}
                    </div>
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
