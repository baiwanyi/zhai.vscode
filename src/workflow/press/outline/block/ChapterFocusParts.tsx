/**
 * 写前查纲面板共用的行级部件：卷纲折叠行、图标标签明细行与统一分隔线。
 * 复用约定：布局只用 Item 组件的内置变体与语义色，条件样式统一经 cn 拼接；
 * 空值文案由共享的 orFallback 收口，分组底色由 DETAIL_GROUP_CLASS 统一供各卡片引用。
 * 关键约束：全部只读展示，不接收事件回调；align 只影响标签与内容的对齐方式。
 */
import { cn } from 'cn'
import { ChevronRight } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemMedia,
    ItemSeparator,
    ItemTitle,
} from '@components/ui/item'
import { orFallback } from '@shared/utils/format'
import type { LucideIcon } from 'lucide-react'
import type { JSX, ReactNode } from 'react'

/** 明细分组的统一底色与紧凑间距 */
export const DETAIL_GROUP_CLASS = 'gap-0 rounded-lg bg-muted/40 p-1.5'

interface CollapsibleFocusRowProps {
    label: string
    value: string
}

/** 卷纲要点的一行：标签即折叠触发器，右侧值随开合显示 */
export function CollapsibleFocusRow({ label, value }: CollapsibleFocusRowProps): JSX.Element {
    return (
        <Collapsible>
            <CollapsibleTrigger asChild>
                <Button variant="secondary" className="group/point w-full justify-start gap-1">
                    {label}
                    <ChevronRight
                        data-icon="inline-end"
                        className="ml-auto shrink-0 transition-transform group-data-[state=open]/point:rotate-90"
                    />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0 flex-1 text-sm">
                <span className="block wrap-break-word whitespace-pre-line p-2">{orFallback(value)}</span>
            </CollapsibleContent>
        </Collapsible>
    )
}

interface ChapterDetailItemProps {
    icon: LucideIcon
    label: string
    /** 内容：纯文本按空值兜底，节点原样渲染（如带角色徽标的动机行） */
    value: ReactNode
    emphasized?: boolean
    action?: ReactNode
    align?: 'end' | 'start'
}

/** 章节明细的一行：图标 + 标签 + 内容；align 为 end 时右对齐，start 时标签定宽顶部对齐、内容左对齐 */
export function ChapterDetailItem({
    icon: Icon,
    label,
    value,
    emphasized = false,
    action,
    align = 'end',
}: ChapterDetailItemProps): JSX.Element {
    const isStart = align === 'start'
    return (
        <Item size="xs" className="px-1.5 py-1">
            <ItemMedia variant="icon">
                <Icon className="text-muted-foreground" />
            </ItemMedia>
            <ItemContent className={cn('flex-row justify-between gap-3', isStart ? 'items-start' : 'items-center')}>
                <ItemTitle className={cn('shrink-0', isStart && 'w-24')}>{label}</ItemTitle>
                <ItemDescription
                    className={cn(
                        'line-clamp-none min-w-0 flex-1 wrap-break-word',
                        isStart ? 'text-left' : 'text-right',
                        emphasized && 'font-medium',
                    )}
                >
                    {typeof value === 'string' ? orFallback(value) : value}
                </ItemDescription>
            </ItemContent>
            {action === undefined ? null : <ItemActions className="shrink-0">{action}</ItemActions>}
        </Item>
    )
}

/** 明细行之间的统一分隔 */
export function DetailSeparator(): JSX.Element {
    return <ItemSeparator className="my-0" />
}
