/**
 * AI 对话用户消息正文：命令徽章与引用徽章内联在正文首行，正文紧随其后并在换行时回到行首。
 * 复用 @components/ui 的 Badge、同目录 commandIcons / AiChatMessageRefs 与 ../utils 的命令前缀拆分。
 * 关键约束：徽章只展示命令名与文件名（完整路径进悬浮提示），不展示指令模板全文；
 * 徽章与正文之间用间距而非真实空格，避免污染消息正文；未命中命令时原样输出；
 * 复制入口在气泡外（见 AiChatMessageView），本组件只负责正文排版，不放任何操作按钮；
 * 正文行高固定 leading-5，与 20px 徽章配合 align-top 才能保证徽章与首行文字几何重合。
 */
import { cn } from 'cn'
import { PencilRuler } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import type { AiMessage } from '@shared/types/aiChat'
import { AiChatMessageRefs } from './AiChatMessageRefs'
import { COMMAND_ICONS } from './commandIcons'
import { useAvailableRuleNames } from './ruleCatalog'
import type { JSX } from 'react'
import { splitCommandContent } from '../utils'

interface AiChatMessageUserBodyProps {
    message: AiMessage
}

export function AiChatMessageUserBody({ message }: AiChatMessageUserBodyProps): JSX.Element {
    const { command, body } = splitCommandContent(message.content)
    const CommandIcon = command === null ? null : COMMAND_ICONS[command.id]
    /** 现存规则名：null 表示目录未读到，此时不做删除态判定，避免把全部徽章误置灰 */
    const availableRules = useAvailableRuleNames()
    return (
        <div className="leading-5 whitespace-pre-wrap wrap-break-word">
            {command === null ? null : (
                <Badge
                    variant="secondary"
                    className="mr-1.5 inline-flex align-top border-0 bg-primary-foreground/15 font-normal text-primary-foreground"
                >
                    {CommandIcon === null ? null : <CommandIcon />}
                    <span className="min-w-0 truncate">{command.title}</span>
                </Badge>
            )}
            {message.ruleNames.map((ruleName) => {
                const isMissing = availableRules !== null && !availableRules.has(ruleName)
                return (
                    <Badge
                        key={ruleName}
                        variant="secondary"
                        title={isMissing ? '该规则已从规则目录中删除' : undefined}
                        className={cn(
                            'mr-1.5 inline-flex align-top border-0 bg-primary-foreground/10 font-normal text-primary-foreground',
                            isMissing && 'line-through opacity-50',
                        )}
                    >
                        <PencilRuler />
                        <span className="min-w-0 truncate">{ruleName}</span>
                    </Badge>
                )
            })}
            <AiChatMessageRefs refs={message.refs} />
            {body.length > 0 ? body : null}
        </div>
    )
}
