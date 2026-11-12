/**
 * 标注列表项：一条划线或批注的摘要，含颜色点、文本、时间、文档与段落片段。
 * 复用约定：Button 承载跳转与删除，时间格式化复用 shared/utils/format；不引入新的卡片组件。
 * 关键约束：删除要行内二次确认（与批注气泡同一交互，避免嵌套弹窗抢焦点）；
 * orphaned 必须显式标注「原文已修改」——用户点进去定位不到，会以为功能坏了。
 */
import { Check, MessageSquareText, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { ANNOTATION_COLORS, readColorCss } from '../colors'

/** 二次确认的等待时长：超时自动复原 */
const CONFIRM_TIMEOUT_MS = 3000

export interface AnnotationListItemProps {
    item: AnnotationRecord
    onReveal: (id: string) => Promise<void>
    onUpdateColor: (id: string, color: HighlightColor) => Promise<void>
    onRemove: (id: string) => Promise<void>
}

export function AnnotationListItem({ item, onReveal, onUpdateColor, onRemove }: AnnotationListItemProps): JSX.Element {
    const [isConfirming, setIsConfirming] = useState(false)
    const [isPickingColor, setIsPickingColor] = useState(false)
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
        <div className="relative flex flex-col gap-1 rounded-md border p-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                    {item.color === null ? (
                        <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                        <button
                            type="button"
                            aria-label="更改颜色"
                            title="更改颜色"
                            className="mt-1 size-2.5 shrink-0 rounded-full ring-offset-1 hover:ring-1 hover:ring-ring"
                            style={{ backgroundColor: readColorCss(item.color) }}
                            onClick={(): void => {
                                setIsPickingColor((previous) => !previous)
                            }}
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
            {isPickingColor && item.color !== null ? (
                <div className="absolute left-6 top-7 z-10 flex items-center gap-1 rounded-md border bg-background p-1 shadow-sm">
                    {ANNOTATION_COLORS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            aria-label={`改为${option.label}`}
                            title={`改为${option.label}`}
                            className="size-3.5 rounded-full ring-offset-1 hover:ring-2 hover:ring-ring"
                            style={{ backgroundColor: option.css }}
                            onClick={(): void => {
                                setIsPickingColor(false)
                                void onUpdateColor(item.id, option.value)
                            }}
                        />
                    ))}
                </div>
            ) : null}
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
