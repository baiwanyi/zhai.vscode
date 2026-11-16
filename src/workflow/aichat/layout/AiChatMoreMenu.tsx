/**
 * 「更多」菜单：收纳写作命令与参考资料两组入口，工具行左侧留给「添加上下文」。
 * 复用约定：外壳取 @components/ui 的 DropdownMenu，触发器取 @webview/components/Button；
 * 命令表与图标取 ../constants 与 ./commandIcons，动作联合类型同样取自 ../constants。
 * 关键约束：工具行严格保持两个按钮——上下文与更多，写作命令不再单独占位；
 * 当前已选命令带勾选标记，再次点击同一项由页面取消，本组件只上抛命令对象。
 */
import { Check, MoreHorizontal } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand, AiCommandId, AiReferenceAction } from '../constants'
import type { JSX } from 'react'
import { AI_COMMANDS } from '../constants'

interface AiChatMoreMenuProps {
    disabled: boolean
    /** 当前已选命令：用于勾选标记 */
    activeId: AiCommandId | null
    onCommand: (command: AiCommand) => void
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
}

export function AiChatMoreMenu({
    disabled,
    activeId,
    onCommand,
    onReference,
    onMention,
}: AiChatMoreMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground"
                    title="更多"
                    aria-label="更多"
                    disabled={disabled}
                >
                    <MoreHorizontal />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>写作命令</DropdownMenuLabel>
                {AI_COMMANDS.map((command) => {
                    const Icon = COMMAND_ICONS[command.id]
                    return (
                        <DropdownMenuItem key={command.id} onSelect={() => onCommand(command)}>
                            <Icon />
                            <span className="flex-1">{command.title}</span>
                            {activeId === command.id ? <Check className="text-muted-foreground" /> : null}
                        </DropdownMenuItem>
                    )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>参考资料</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onReference('search')}>检索参考资料</DropdownMenuItem>
                <DropdownMenuItem onSelect={onMention}>引用笔记 / 章节</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onReference('openDir')}>打开语料目录</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
