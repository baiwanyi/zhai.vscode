/**
 * 标注列表项：一条划线或批注的摘要，含颜色点、文本、时间、文档与段落片段。
 * 复用约定：骨架取 @components/ui/item 的槽位（媒体 / 内容 / 操作 / 页脚），外层由 AnnotationListSection
 * 统一用 ItemGroup 包裹，本组件不再自带列表容器；删除确认取 @webview/blocks/DeleteConfirmButton，
 * 按钮取 Button，时间格式化复用 shared/utils/format。
 * 关键约束：骨架与 QueryRecordItem 同构，颜色点包在与图标同宽的容器里，两个列表的文字起点才对得上；
 * 删除走确认弹窗而不是行内二次点击：行内确认有超时，用户稍一犹豫就会重来，表现为「删不掉」；
 * orphaned 必须显式标注「原文已修改」——用户点进去定位不到，会以为功能坏了；
 * 颜色点与色板收在同文件 ColorPicker 里，条目只负责把选中值交给 onUpdateColor。
 */
'use client'

import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { DeleteConfirmButton } from '@webview/blocks/DeleteConfirmButton'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { ANNOTATION_COLORS, readColorCss } from '../colors'

export interface AnnotationListItemProps {
    item: AnnotationRecord
    onReveal: (id: string) => Promise<void>
    onUpdateColor: (id: string, color: HighlightColor) => Promise<void>
    onRemove: (id: string) => Promise<void>
}

interface ColorPickerProps {
    color: HighlightColor
    /** 选中回调：条目据此提交改色，本组件只管开合与色板 */
    onSelect: (next: HighlightColor) => void
}

/**
 * 颜色点与色板：圆点比图标窄，包一层与图标同宽的容器，两条列表的文字起点才对得上。
 * 开合交给 Popover 原语，外部点击与 Esc 都会关闭，不在这里手写浮层与监听。
 */
function ColorPicker({ color, onSelect }: ColorPickerProps): JSX.Element {
    const [isPicking, setIsPicking] = useState(false)

    return (
        <span className="flex size-4 items-center justify-center">
            <Popover open={isPicking} onOpenChange={setIsPicking}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label="更改颜色"
                        title="更改颜色"
                        className="size-2.5 rounded-full ring-offset-1 hover:ring-1 hover:ring-ring"
                        style={{ backgroundColor: readColorCss(color) }}
                    />
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-auto p-1">
                    <div className="flex items-center gap-1">
                        {ANNOTATION_COLORS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                aria-label={`改为${option.label}`}
                                title={`改为${option.label}`}
                                className="size-3.5 rounded-full ring-offset-1 hover:ring-2 hover:ring-ring"
                                style={{ backgroundColor: option.css }}
                                onClick={(): void => {
                                    setIsPicking(false)
                                    onSelect(option.value)
                                }}
                            />
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
        </span>
    )
}

export function AnnotationListItem({ item, onReveal, onUpdateColor, onRemove }: AnnotationListItemProps): JSX.Element {
    return (
        <>
            <Item variant="outline">
                <ItemMedia variant="icon">
                    {item.color === null ? (
                        <MessageSquareText className="text-muted-foreground" />
                    ) : (
                        <ColorPicker
                            color={item.color}
                            onSelect={(next): void => {
                                void onUpdateColor(item.id, next)
                            }}
                        />
                    )}
                </ItemMedia>
                <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-2 wrap-break-word">{item.quote}</ItemTitle>
                    {item.blockText.length === 0 ? null : (
                        <ItemDescription className="line-clamp-1 text-xs wrap-break-word">
                            {item.blockText}
                        </ItemDescription>
                    )}
                    {item.kind === 'note' && item.note !== null && item.note.length > 0 ? (
                        // 批注正文可能很长：限三行，超出用省略号收尾，完整内容去编辑区看
                        <ItemDescription className="line-clamp-3 whitespace-pre-wrap text-xs wrap-break-word">
                            {item.note}
                        </ItemDescription>
                    ) : null}
                </ItemContent>
                <ItemActions>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(): void => {
                            void onReveal(item.id)
                        }}
                    >
                        跳转
                    </Button>
                    <DeleteConfirmButton
                        tooltip="删除标注"
                        title="删除这条标注？"
                        description="删除后不可恢复，原文中的划线或批注会一并移除。"
                        onConfirm={(): void => {
                            void onRemove(item.id)
                        }}
                    />
                </ItemActions>
                <ItemFooter className="text-xs text-muted-foreground">
                    <span className="max-w-[50%] truncate">{item.docTitle}</span>
                    <div className="flex items-center gap-2">
                        <span>{formatDateTime(item.createdAt)}</span>
                        {item.orphaned ? <span className="text-destructive">原文已修改</span> : null}
                    </div>
                </ItemFooter>
            </Item>
        </>
    )
}
