/**
 * AI 对话写作命令菜单：顶部工具行左侧的「命令」按钮，展开四项预设指令。
 * 复用 @/components/ui 的 DropdownMenu 与 ../constants 的命令表，图标按命令 id 映射。
 * 关键约束：生成中整组禁用；本组件只上抛命令对象，不持有输入内容与写回策略。
 */
import { Command, PenLine, Sparkles, Type, Wand2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import type { AiCommand, AiCommandId } from '../constants'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import { AI_COMMANDS } from '../constants'

/** 命令图标映射：与常量表解耦，避免常量文件依赖 UI 图标库 */
const COMMAND_ICONS: Record<AiCommandId, LucideIcon> = {
    rewrite: PenLine,
    polish: Wand2,
    typo: Type,
    deai: Sparkles,
}

interface AiChatCommandMenuProps {
    disabled: boolean
    onSelect: (command: AiCommand) => void
}

export function AiChatCommandMenu({ disabled, onSelect }: AiChatCommandMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <InputGroupButton
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full"
                    title="写作命令"
                    aria-label="写作命令"
                    disabled={disabled}
                >
                    <Command />
                </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>写作命令</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {AI_COMMANDS.map((command) => {
                    const Icon = COMMAND_ICONS[command.id]
                    return (
                        <DropdownMenuItem key={command.id} onSelect={() => onSelect(command)}>
                            <Icon />
                            {command.title}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
