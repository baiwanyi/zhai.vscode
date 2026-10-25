/**
 * AI 对话用户消息正文：命令徽章与引用徽章内联在正文首行，正文紧随其后并在换行时回到行首。
 * 复用 @components/ui 的 Badge、同目录 commandIcons / AiChatMessageRefs 与 ../utils 的命令前缀拆分。
 * 关键约束：徽章只展示命令名与文件名（完整路径进悬浮提示），不展示指令模板全文；
 * 徽章与正文之间用间距而非真实空格，避免污染消息正文；未命中命令时原样输出；
 * 正文行高固定 leading-5，与 20px 徽章配合 align-top 才能保证徽章与首行文字几何重合。
 */
import { Badge } from '@components/ui/badge'
import type { AiMessage } from '@shared/types/aiChat'
import { AiChatMessageRefs } from './AiChatMessageRefs'
import { COMMAND_ICONS } from './commandIcons'
import type { JSX } from 'react'
import { splitCommandContent } from '../utils'

interface AiChatMessageUserBodyProps {
    message: AiMessage
}

export function AiChatMessageUserBody({ message }: AiChatMessageUserBodyProps): JSX.Element {
    const { command, body } = splitCommandContent(message.content)
    const CommandIcon = command === null ? null : COMMAND_ICONS[command.id]
    return (
        <div className="leading-5 whitespace-pre-wrap break-words">
            {command === null ? null : (
                <Badge
                    variant="secondary"
                    className="mr-1.5 inline-flex align-top border-0 bg-primary-foreground/15 font-normal text-primary-foreground"
                >
                    {CommandIcon === null ? null : <CommandIcon />}
                    <span className="min-w-0 truncate">{command.title}</span>
                </Badge>
            )}
            <AiChatMessageRefs refs={message.refs} />
            {body.length > 0 ? body : null}
        </div>
    )
}
