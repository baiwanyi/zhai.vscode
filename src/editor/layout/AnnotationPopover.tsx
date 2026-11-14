/**
 * 段末批注气泡：列出该段的全部批注，支持编辑正文与删除（行内二次确认）。
 * 复用约定：shadcn Popover + Button + ScrollArea + Textarea，锚点为 fixed 零尺寸元素，
 * 与浮动菜单同一套定位方式；正文编辑就地展开，不另开 Dialog。
 * 关键约束：删除要点两次（第一次变「确认删除」，3 秒后复原）——批注删除不可撤销，
 * 但也不该为每条弹确认对话框；编辑态必须放过 mousedown，否则 Textarea 拿不到焦点；
 * 保存失败不收起编辑态、不丢草稿，二次确认计时器随关闭与切换一并清理，避免跨次串扰。
 */
import { Check, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { ScrollArea } from '@components/ui/scroll-area'
import { Textarea } from '@components/ui/textarea'
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
    /** 保存批注正文：返回 false 时保留编辑态与草稿，提示由调用方给出 */
    onUpdateNote: (id: string, note: string) => Promise<boolean>
    /** 删除标注：返回 false 时条目仍在列表里，提示由调用方给出 */
    onRemove: (id: string) => Promise<boolean>
}

export function AnnotationPopover({
    isOpen,
    left,
    top,
    items,
    onOpenChange,
    onUpdateNote,
    onRemove,
}: AnnotationPopoverProps): JSX.Element | null {
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [savingId, setSavingId] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    /** 清掉二次确认计时器：卸载、关闭、重复点击都走这里，否则旧计时器会清掉下一次的待确认态 */
    const clearConfirmTimer = useCallback((): void => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    useEffect(() => {
        return (): void => {
            clearConfirmTimer()
        }
    }, [clearConfirmTimer])

    /** 关闭即清空确认与编辑态：不在渲染期同步 setState */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            clearConfirmTimer()
            setPendingId(null)
            setEditingId(null)
            setDraft('')
            setSavingId(null)
        }
        onOpenChange(nextOpen)
    }

    if (!isOpen || items.length === 0) {
        return null
    }

    const handleRemove = async (id: string): Promise<void> => {
        if (pendingId !== id) {
            setPendingId(id)
            clearConfirmTimer()
            timerRef.current = setTimeout((): void => {
                setPendingId(null)
                timerRef.current = null
            }, CONFIRM_TIMEOUT_MS)
            return
        }
        clearConfirmTimer()
        setPendingId(null)
        await onRemove(id)
    }

    /**
     * 保存当前草稿：返回是否已落盘（空草稿无需保存，视为可继续）。
     * 失败时保留编辑态与草稿，让用户改完再试，不能收起当成功。
     */
    const saveDraft = async (id: string): Promise<boolean> => {
        if (draft.trim() === '') {
            return true
        }
        if (savingId !== null) {
            return false
        }
        setSavingId(id)
        try {
            const isSaved = await onUpdateNote(id, draft.trim())
            if (isSaved) {
                setEditingId(null)
                setDraft('')
            }
            return isSaved
        } finally {
            setSavingId(null)
        }
    }

    /** 切到另一条编辑：先把当前草稿存下来，直接切换会把未保存的修改覆盖掉 */
    const handleEdit = async (id: string, note: string | null): Promise<void> => {
        if (editingId !== null && editingId !== id && !(await saveDraft(editingId))) {
            return
        }
        setEditingId(id)
        setDraft(note ?? '')
    }

    return (
        <Popover open onOpenChange={handleOpenChange}>
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={{ left, top }} />
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="start"
                className="w-80 p-2"
                onMouseDown={(event): void => {
                    // 编辑态要放过默认行为，否则 Textarea 无法获得焦点
                    if (editingId === null) {
                        event.preventDefault()
                    }
                }}
            >
                {/* 限高必须落在 Viewport 上：Root 只有 max-height 时其百分比高度无法解析，内容会溢出而不是滚动 */}
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-72">
                    <div className="flex flex-col gap-2">
                        {items.map((item) => (
                            <div key={item.id} className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.quote}</p>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label="编辑批注"
                                            onClick={(): void => void handleEdit(item.id, item.note)}
                                        >
                                            <Pencil className="size-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={pendingId === item.id ? '确认删除' : '删除批注'}
                                            onClick={(): void => void handleRemove(item.id)}
                                        >
                                            {pendingId === item.id ? (
                                                <Check className="size-3.5" />
                                            ) : (
                                                <Trash2 className="size-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                {editingId === item.id ? (
                                    <div className="flex flex-col gap-1">
                                        <Textarea
                                            autoFocus
                                            rows={3}
                                            value={draft}
                                            onChange={(event): void => {
                                                setDraft(event.target.value)
                                            }}
                                        />
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={(): void => {
                                                    setEditingId(null)
                                                    setDraft('')
                                                }}
                                            >
                                                取消
                                            </Button>
                                            <Button
                                                size="sm"
                                                isLoading={savingId === item.id}
                                                disabled={draft.trim() === ''}
                                                onClick={(): void => void saveDraft(item.id)}
                                            >
                                                保存
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap text-sm">{item.note}</p>
                                )}
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
