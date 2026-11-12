/**
 * 标注列表项：一条划线或批注的摘要，含颜色点、文本、时间、文档与段落片段。
 * 复用约定：Button 承载跳转与删除，时间格式化复用 shared/utils/format；不引入新的卡片组件。
 * 关键约束：删除要行内二次确认（与批注气泡同一交互，避免嵌套弹窗抢焦点）；
 * orphaned 必须显式标注「原文已修改」——用户点进去定位不到，会以为功能坏了。
 */
import { Check, MessageSquareText, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AnnotationRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { readColorCss } from '../colors'

/** 二次确认的等待时长：超时自动复原 */
const CONFIRM_TIMEOUT_MS = 3000

export interface AnnotationListItemProps {
    item: AnnotationRecord
    onReveal: (id: string) => Promise<void>
    onRemove: (id: string) => Promise<void>
}

export function AnnotationListItem({ item, onReveal, onRemove }: AnnotationListItemProps): JSX.Element {
    const [isConfirming, setIsConfirming] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleRemove = (): void => {
        if (!isConfirming) {
            setIsConfirming(true)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
            }
            timerRef.current = setTimeout((): void => {
                setIsConfirming(false)
                timerRef.current = null
            }, CONFIRM_TIMEOUT_MS)
            return
        }
        setIsConfirming(false)
        void onRemove(item.id)
    }

    return (
        <div className="flex flex-col gap-1 rounded-md border p-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                    {item.color === null ? (
                        <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                        <span
                            className="mt-1.5 size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: readColorCss(item.color) }}
                        />
                    )}
                    <span className="line-clamp-2 text-sm">{item.quote}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(): void => {
                            void onReveal(item.id)
                        }}
                    >
                        跳转
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={isConfirming ? '确认删除' : '删除标注'}
                        onClick={handleRemove}
                    >
                        {isConfirming ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
                    </Button>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="max-w-[50%] truncate">{item.docTitle}</span>
                <span>{formatDateTime(item.createdAt)}</span>
                {item.orphaned ? <span className="text-destructive">原文已修改</span> : null}
            </div>
            {item.blockText.length === 0 ? null : (
                <p className="line-clamp-1 text-xs text-muted-foreground">{item.blockText}</p>
            )}
            {item.kind === 'note' && item.note !== null ? (
                <p className="whitespace-pre-wrap text-xs">{item.note}</p>
            ) : null}
        </div>
    )
}
