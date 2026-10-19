/**
 * AI 对话顶栏：左侧会话元信息（标题与用量），右侧「历史对话」浮层与新建会话按钮。
 * 组合同目录 AiChatSessionMeta 与 AiChatHistoryMenu，为纯布局容器；交互全部经回调上抛给页面 hooks。
 */
import { SquarePen } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { AiConversationSummary, AiRuntimeInfo } from '@shared/types/aiChat'
import { AiChatHistoryMenu } from './AiChatHistoryMenu'
import { AiChatSessionMeta } from './AiChatSessionMeta'
import type { JSX } from 'react'

interface AiChatHeaderProps {
    title: string
    runtime: AiRuntimeInfo | null
    sessions: AiConversationSummary[]
    activeSessionId: string | undefined
    onOpenHistory: () => void
    onSwitchSession: (id: string) => void
    onDeleteSession: (id: string) => void
    onNewSession: () => void
}

export function AiChatHeader({
    title,
    runtime,
    sessions,
    activeSessionId,
    onOpenHistory,
    onSwitchSession,
    onDeleteSession,
    onNewSession,
}: AiChatHeaderProps): JSX.Element {
    return (
        <header className="flex items-start justify-between gap-2 mx-3 py-2.5  border-b border-border">
            <AiChatSessionMeta title={title} runtime={runtime} />
            <div className="flex shrink-0 items-center gap-1">
                <AiChatHistoryMenu
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onOpen={onOpenHistory}
                    onSwitch={onSwitchSession}
                    onDelete={onDeleteSession}
                />
                <Button
                    size="icon-sm"
                    variant="secondary"
                    className="rounded-full"
                    title="新建会话"
                    onClick={onNewSession}
                >
                    <SquarePen />
                </Button>
            </div>
        </header>
    )
}
