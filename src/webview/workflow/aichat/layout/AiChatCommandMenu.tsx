/**
 * AI 对话写作命令菜单：顶部工具行左侧的「命令」按钮，展开四项预设指令，当前选中项带勾选标记。
 * 复用 @components/ui 的 DropdownMenu 与 ../constants 的命令表，图标映射与输入区徽章共用 commandIcons。
 * 关键约束：生成中整组禁用；本组件只上抛命令对象，不写输入框、不持有写回策略。
 */
import { Check, Command } from 'lucide-react'
import { Button } from '@components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand, AiCommandId } from '../constants'
import type { JSX } from 'react'
import { AI_COMMANDS } from '../constants'

interface AiChatCommandMenuProps {
    disabled: boolean
    /** 当前已选命令：用于勾选标记，再次点击同一项即取消 */
    activeId: AiCommandId | null
    onSelect: (command: AiCommand) => void
}

export function AiChatCommandMenu({ disabled, activeId, onSelect }: AiChatCommandMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-muted-foreground"
                    title="写作命令"
                    aria-label="写作命令"
                    disabled={disabled}
                >
                    <Command />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>写作命令</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {AI_COMMANDS.map((command) => {
                    const Icon = COMMAND_ICONS[command.id]
                    return (
                        <DropdownMenuItem key={command.id} onSelect={() => onSelect(command)}>
                            <Icon />
                            <span className="flex-1">{command.title}</span>
                            {activeId === command.id ? <Check className="text-muted-foreground" /> : null}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
