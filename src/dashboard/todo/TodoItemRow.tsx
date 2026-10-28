/**
 * 单条待办：胶囊卡片内的开关、正文与删除按钮，开关开启即表示已完成。
 * 复用约定：卡片与槽位取 @components/ui 的 item，开关取 @webview/components/Switch，
 * 删除入口取 @webview/components/Button（destructive + icon-sm），图标用 lucide 的 Trash2。
 * 关键约束：删除按钮默认不可见，仅在悬停、行内聚焦、触屏设备与「当前激活行」时显示——
 * 键盘用户靠 focus-within 兜底（按钮自身聚焦必属行内聚焦，故不再单写 focus-visible），
 * 触屏没有 hover 故常显；正文单行截断，全文挂在原生 title 上，避免长待办被截断后看不全。
 */
'use client'

import { cn } from 'cn'
import { Trash2 } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@components/ui/item'
import type { TodoItem } from '@shared/types/todo'
import { Button } from '@webview/components/Button'
import { Switch } from '@webview/components/Switch'
import type { JSX } from 'react'

/**
 * 删除按钮的可见性：默认隐藏，悬停 / 行内聚焦 / 触屏 / 激活行时显示。
 * 关键约束：悬停挂在 Item 自带的具名分组 group/item 上，不能用无名 group——
 * 行本身没有 group 类，无名变体找不到宿主，按钮会一直保持透明。
 */
const DELETE_VISIBILITY_CLASS =
    'opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100 [@media(pointer:coarse)]:opacity-100'

export interface TodoItemRowProps {
    item: TodoItem
    /** 是否为当前激活行：点击该行后删除按钮常显 */
    isActive: boolean
    isDisabled: boolean
    onToggle: (item: TodoItem) => void
    onDelete: (item: TodoItem) => void
    onActivate: (index: number) => void
}

export function TodoItemRow({
    item,
    isActive,
    isDisabled,
    onToggle,
    onDelete,
    onActivate,
}: TodoItemRowProps): JSX.Element {
    const toggleLabel = item.done ? '标记为未完成' : '标记为已完成'

    return (
        <Item variant="outline" onPointerDown={() => onActivate(item.index)}>
            <ItemMedia>
                <Switch
                    checked={item.done}
                    disabled={isDisabled}
                    aria-label={`${toggleLabel}：${item.text}`}
                    onCheckedChange={() => onToggle(item)}
                />
            </ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle
                    className={cn(
                        'max-w-full truncate text-sm font-normal',
                        item.done && 'text-muted-foreground line-through',
                    )}
                    title={item.text}
                >
                    {item.text}
                </ItemTitle>
            </ItemContent>
            <ItemActions>
                <Button
                    variant="destructive"
                    size="icon-sm"
                    tooltip="删除这条待办"
                    aria-label={`删除待办：${item.text}`}
                    disabled={isDisabled}
                    className={cn(DELETE_VISIBILITY_CLASS, isActive && 'opacity-100')}
                    onClick={() => onDelete(item)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
