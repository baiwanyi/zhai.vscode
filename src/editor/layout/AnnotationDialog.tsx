/**
 * 新建批注弹窗：展示选中的引用片段，输入正文后提交。
 * 复用约定：shadcn Dialog + Textarea + Button，与后续查询弹窗共用同一套容器与间距。
 * 关键约束：每次打开都清空输入；提交中禁用按钮，避免连点插入两条相同批注。
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
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

export interface AnnotationDialogProps {
    isOpen: boolean
    /** 选中的引用片段：只读展示，帮助用户确认批注对象 */
    quote: string
    onOpenChange: (isOpen: boolean) => void
    onSubmit: (note: string) => Promise<void>
}

export function AnnotationDialog({ isOpen, quote, onOpenChange, onSubmit }: AnnotationDialogProps): JSX.Element {
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    /** 关闭即清空：下次打开是干净状态，且不在渲染期做状态同步（避免额外一轮渲染） */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            setNote('')
            setIsSubmitting(false)
        }
        onOpenChange(nextOpen)
    }

    const handleSubmit = async (): Promise<void> => {
        if (note.trim() === '' || isSubmitting) {
            return
        }
        setIsSubmitting(true)
        try {
            await onSubmit(note.trim())
            handleOpenChange(false)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>新建批注</DialogTitle>
                    <DialogDescription className="line-clamp-2 border-l-2 pl-2 text-muted-foreground">
                        {quote}
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    autoFocus
                    value={note}
                    rows={5}
                    placeholder="写下你的想法，支持轻量 Markdown"
                    onChange={(event): void => {
                        setNote(event.target.value)
                    }}
                />
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={(): void => {
                            handleOpenChange(false)
                        }}
                    >
                        取消
                    </Button>
                    <Button isLoading={isSubmitting} onClick={(): void => void handleSubmit()}>
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
