/**
 * 段末批注气泡：列出该段的全部批注，支持删除（行内二次确认）。
 * 复用约定：shadcn Popover + Button + ScrollArea，锚点为 fixed 零尺寸元素，与浮动菜单同一套定位方式。
 * 关键约束：删除要点两次（第一次变「确认删除」，3 秒后复原）——批注删除不可撤销，
 * 但也不该为每条弹一个确认对话框，嵌套 Portal 会抢焦点并可能把气泡关掉。
 */
import { Check, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { ScrollArea } from '@components/ui/scroll-area'
import type { AnnotationRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 二次确认的等待时长：超时自动复原，避免误触后长期处于待删状态 */
const CONFIRM_TIMEOUT_MS = 3000

export interface AnnotationPopoverProps {
    isOpen: boolean
    left: number
    top: number
    items: readonly AnnotationRecord[]
    onOpenChange: (isOpen: boolean) => void
    onRemove: (id: string) => Promise<void>
}

export function AnnotationPopover({
    isOpen,
    left,
    top,
    items,
    onOpenChange,
    onRemove,
}: AnnotationPopoverProps): JSX.Element | null {
    const [pendingId, setPendingId] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return (): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [])

    /** 关闭即清空二次确认状态：不在渲染期同步 setState，避免额外一轮渲染 */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            setPendingId(null)
        }
        onOpenChange(nextOpen)
    }

    if (!isOpen || items.length === 0) {
        return null
    }

    const handleRemove = (id: string): void => {
        if (pendingId !== id) {
            setPendingId(id)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
            }
            timerRef.current = setTimeout((): void => {
                setPendingId(null)
                timerRef.current = null
            }, CONFIRM_TIMEOUT_MS)
            return
        }
        setPendingId(null)
        void onRemove(id)
    }

    return (
        <Popover open onOpenChange={handleOpenChange}>
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={{ left, top }} />
            </PopoverAnchor>
            <PopoverContent side="bottom" align="start" className="w-80 p-2">
                <ScrollArea className="max-h-72">
                    <div className="flex flex-col gap-2">
                        {items.map((item) => (
                            <div key={item.id} className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.quote}</p>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={pendingId === item.id ? '确认删除' : '删除批注'}
                                        onClick={(): void => {
                                            handleRemove(item.id)
                                        }}
                                    >
                                        {pendingId === item.id ? (
                                            <Check className="size-3.5" />
                                        ) : (
                                            <Trash2 className="size-3.5" />
                                        )}
                                    </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-sm">{item.note}</p>
                                <span className="text-[11px] text-muted-foreground">
                                    {formatDateTime(item.createdAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
