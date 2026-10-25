/**
 * AI 对话历史浮层：「历史对话」触发按钮 + DropdownMenu 面板（对齐 Copilot：标题 + 相对时间，hover 显示删除）。
 * 每次打开面板时经 onOpen 重新拉取列表，避免展示过期数据；条目渲染复用同目录 AiChatHistoryItem。
 * 切换 / 删除动作经回调上抛，本组件不持有会话状态。
 */
import { History } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import { AiChatHistoryItem } from './AiChatHistoryItem'
import type { JSX } from 'react'

interface AiChatHistoryMenuProps {
    sessions: AiConversationSummary[]
    activeSessionId: string | undefined
    onOpen: () => void
    onSwitch: (id: string) => void
    onDelete: (id: string) => void
}

export function AiChatHistoryMenu({
    sessions,
    activeSessionId,
    onOpen,
    onSwitch,
    onDelete,
}: AiChatHistoryMenuProps): JSX.Element {
    return (
        <DropdownMenu
            onOpenChange={(isOpen: boolean) => {
                if (isOpen) {
                    onOpen()
                }
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" title="历史对话" aria-label="历史对话">
                    <History />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>历史对话</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {sessions.length === 0 ? (
                    <DropdownMenuItem disabled>暂无历史对话</DropdownMenuItem>
                ) : (
                    <DropdownMenuGroup>
                        {sessions.map((item) => (
                            <AiChatHistoryItem
                                key={item.id}
                                session={item}
                                isActive={item.id === activeSessionId}
                                onSelect={() => onSwitch(item.id)}
                                onDelete={() => onDelete(item.id)}
                            />
                        ))}
                    </DropdownMenuGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
