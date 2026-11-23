/**
 * 历史会话行：主体是可点击区（标题 + 来源与时间），删除按钮平级在行尾。
 * 复用约定：来源文案取 utils/historyFilters 的 formatScopeText，与筛选标签同源；外壳复用 @components/ui/item，
 * 删除按钮复用 webview 的 Button（图标态 + tooltip），时间格式化复用 shared/utils/format。
 * 关键约束：删除按钮必须是主体的兄弟节点 —— 套进主体会让键盘事件冒泡成「切换 + 删除」，
 * 读屏也会读成两个重叠按钮；主体用 div + role="button" 而不是原生 button，
 * 因为标题与描述是块级元素，button 的内容模型只允许行内元素。
 */
import { cn } from 'cn'
import { Trash2 } from 'lucide-react'
import { memo } from 'react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { formatRelativeTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { formatScopeText } from '../utils/historyFilters'

export interface AiChatHistoryRowProps {
    session: AiConversationSummary
    isActive: boolean
    onSelect: (id: string) => void
    onDelete: (id: string) => void
}

export const AiChatHistoryRow = memo(function AiChatHistoryRow({
    session,
    isActive,
    onSelect,
    onDelete,
}: AiChatHistoryRowProps): JSX.Element {
    return (
        <Item variant="outline" className={cn('p-0', isActive && 'border-primary')}>
            <div
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => onSelect(session.id)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(session.id)
                    }
                }}
            >
                <ItemContent>
                    <ItemTitle>{session.title}</ItemTitle>
                    <ItemDescription className="text-xs">{`${formatScopeText(session)} · ${formatRelativeTime(session.updatedAt)}`}</ItemDescription>
                </ItemContent>
            </div>
            <ItemActions className="shrink-0 pr-2">
                <Button
                    variant="ghost"
                    size="icon"
                    tooltip="删除会话"
                    aria-label="删除会话"
                    className="hover:text-destructive"
                    onClick={() => onDelete(session.id)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
})
