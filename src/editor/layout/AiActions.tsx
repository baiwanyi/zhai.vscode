/**
 * 工具条的 AI 入口：询问 AI 与「选中行加入 AI 对话」，两者都只把选中文本交出去。
 * 复用约定：按钮用 @webview/components/Button，图标取 lucide-react；
 * 行号换算、引用去重与跳转都在宿主侧完成，这里不解析路径也不拼引用。
 * 关键约束：块范围由外层冻结后传入，null 表示定位不到（快照尚未就绪），必须提示而不是静默无反应；
 * 动作执行后统一 onDismiss 收起浮层，否则弹窗与工具条会叠在一起。
 */
import { MessageSquarePlus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@webview/components/Button'
import type { SelectionBlockRange } from '../blocks/blockCommands'
import type { JSX } from 'react'

export interface AiActionsProps {
    /** 选中的纯文本：由外层冻结，点击时不再现读选区 */
    text: string
    /** 选区覆盖的快照块范围：null 时无法换算整行引用 */
    blockRange: SelectionBlockRange | null
    onQuery: (quote: string) => void
    onAddToChat: (quote: string, blockRange: SelectionBlockRange) => void
    onDismiss: () => void
}

export function AiActions({ text, blockRange, onQuery, onAddToChat, onDismiss }: AiActionsProps): JSX.Element {
    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                onClick={(): void => {
                    onQuery(text)
                    onDismiss()
                }}
            >
                <Sparkles className="size-3.5" />
                询问 AI
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                tooltip="选中行加入 AI 对话"
                aria-label="选中行加入 AI 对话"
                onClick={(): void => {
                    // 块序号随选区一起冻结，这里不再读 editor；定位不到说明快照尚未就绪，直接提示
                    if (blockRange === null) {
                        toast.error('未能在文档中定位选中的行')
                        return
                    }
                    onAddToChat(text, blockRange)
                    onDismiss()
                }}
            >
                <MessageSquarePlus className="size-3.5" />
            </Button>
        </>
    )
}
