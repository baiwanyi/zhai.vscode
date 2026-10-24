/**
 * AI 对话历史会话条目（对齐 Copilot）：标题 + 相对时间，hover 时用删除按钮顶替时间位置、避免行宽跳动。
 * 复用 @components/ui 的 dropdown-menu/button 与 webview 公共的相对时间格式化，为纯展示组件。
 * 关键约束：删除按钮须 stopPropagation，避免触发条目自身的切换会话回调。
 */
import { cn } from 'cn'
import { Trash2 } from 'lucide-react'
import { DropdownMenuItem } from '@components/ui/dropdown-menu'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { formatRelativeTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface AiChatHistoryItemProps {
    session: AiConversationSummary
    isActive: boolean
    onSelect: () => void
    onDelete: () => void
}

/** 历史会话条目（对齐 Copilot）：标题 + 相对时间，hover 时用删除按钮顶替时间位置，避免行宽跳动 */
export function AiChatHistoryItem({ session, isActive, onSelect, onDelete }: AiChatHistoryItemProps): JSX.Element {
    return (
        <DropdownMenuItem onSelect={onSelect} className="group/history gap-2">
            <span className={cn('min-w-0 flex-1 truncate', isActive && 'font-medium')}>{session.title}</span>
            <span className="grid shrink-0 place-items-center">
                <span className="col-start-1 row-start-1 text-muted-foreground group-hover/history:opacity-0">
                    {formatRelativeTime(session.updatedAt)}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="col-start-1 row-start-1 opacity-0 group-hover/history:opacity-100"
                    title="删除会话"
                    aria-label="删除会话"
                    onClick={(event) => {
                        event.stopPropagation()
                        onDelete()
                    }}
                >
                    <Trash2 />
                </Button>
            </span>
        </DropdownMenuItem>
    )
}
