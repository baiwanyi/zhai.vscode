/**
 * 逐段写回预览弹窗：按变更块列出原文与新文，勾选后一次写回。
 * 复用约定：外壳取 @components/ui/dialog，按钮取 @webview/components/Button，勾选沿用原生 checkbox（无需额外封装）；
 * 关键约束：默认全选；未勾选的段在写回时保留原文；段列表自身滚动，弹窗高度不随段数增长；
 * 勾选状态用 key 重挂载重置（不在 effect 里同步 setState），关闭或写回成功后由调用方把 diff 置空。
 */
import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import type { AiWriteDiff, AiWriteHunk } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface AiChatDiffDialogProps {
    /** 预览数据：null 时弹窗关闭 */
    diff: AiWriteDiff | null
    /** 写回进行中：按钮禁用，避免重复提交 */
    applying: boolean
    onApply: (accepted: number[]) => void
    onClose: () => void
}

export function AiChatDiffDialog({ diff, applying, onApply, onClose }: AiChatDiffDialogProps): JSX.Element {
    return (
        <Dialog open={diff !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>逐段应用变更</DialogTitle>
                    <DialogDescription>
                        {diff === null ? '' : `${diff.label} · 共 ${String(diff.hunks.length)} 段，未勾选的段保留原文`}
                    </DialogDescription>
                </DialogHeader>
                {/* key 换取重挂载：换一条消息的预览时勾选状态自然回到全选，无需在 effect 里同步 */}
                <DiffHunkPicker
                    key={diff?.messageId ?? 'empty'}
                    hunks={diff?.hunks ?? []}
                    applying={applying}
                    onApply={onApply}
                    onClose={onClose}
                />
            </DialogContent>
        </Dialog>
    )
}

interface DiffHunkPickerProps {
    hunks: readonly AiWriteHunk[]
    applying: boolean
    onApply: (accepted: number[]) => void
    onClose: () => void
}

/** 段列表与提交按钮：与弹窗同挂载周期，选中状态在打开时初始化为全选 */
function DiffHunkPicker({ hunks, applying, onApply, onClose }: DiffHunkPickerProps): JSX.Element {
    const [selected, setSelected] = useState<Set<number>>(() => new Set(hunks.map((_hunk, index) => index)))

    const toggle = (index: number): void => {
        setSelected((previous) => {
            const next = new Set(previous)
            if (next.has(index)) {
                next.delete(index)
            } else {
                next.add(index)
            }
            return next
        })
    }

    return (
        <>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                {hunks.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">回复与原文一致，无需写回</div>
                ) : (
                    hunks.map((hunk, index) => (
                        <label
                            key={`${String(hunk.oldStartLine)}-${String(hunk.newStartLine)}-${String(index)}`}
                            className="flex cursor-pointer gap-2 border-b border-border p-2 last:border-b-0 hover:bg-muted/40"
                        >
                            <input
                                type="checkbox"
                                className="mt-1 size-3.5 shrink-0"
                                checked={selected.has(index)}
                                onChange={() => toggle(index)}
                            />
                            <div className="min-w-0 flex-1 font-mono text-xs leading-relaxed">
                                {hunk.oldText.map((line, lineIndex) => (
                                    <div key={`old-${String(lineIndex)}`} className="truncate text-destructive">
                                        - {line}
                                    </div>
                                ))}
                                {hunk.newText.map((line, lineIndex) => (
                                    <div key={`new-${String(lineIndex)}`} className="truncate text-emerald-600">
                                        + {line}
                                    </div>
                                ))}
                            </div>
                        </label>
                    ))
                )}
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={onClose}>
                    取消
                </Button>
                <Button
                    variant="primary"
                    disabled={applying || selected.size === 0}
                    onClick={() => onApply([...selected])}
                >
                    {applying ? '正在写入…' : `应用选中 ${String(selected.size)} 段`}
                </Button>
            </DialogFooter>
        </>
    )
}
