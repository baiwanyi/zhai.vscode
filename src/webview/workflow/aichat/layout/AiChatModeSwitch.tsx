/**
 * AI 对话模式切换按钮：底部操作行左侧唯一控件，在对话模式与写作模式之间切换。
 * 复用 @components/ui 的 DropdownMenu 与 InputGroupButton，当前模式以勾选标记。
 * 关键约束：生成中禁用切换；本组件只上抛目标模式，模式持久化由会话 hook 承担。
 */
import { Check, ChevronDown, MessageSquare, PenLine } from 'lucide-react'
import { Button } from '@components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { AiConversationMode } from '@shared/types/aiChat'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 模式展示文案 */
const MODE_LABELS: Record<AiConversationMode, string> = {
    chat: '对话',
    write: '写作',
}

/** 模式图标 */
const MODE_ICONS: Record<AiConversationMode, LucideIcon> = {
    chat: MessageSquare,
    write: PenLine,
}

/** 菜单展示顺序 */
const MODES: readonly AiConversationMode[] = ['chat', 'write']

interface AiChatModeSwitchProps {
    mode: AiConversationMode
    disabled: boolean
    onChange: (mode: AiConversationMode) => void
}

export function AiChatModeSwitch({ mode, disabled, onChange }: AiChatModeSwitchProps): JSX.Element {
    const ModeIcon = MODE_ICONS[mode]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1 rounded-lg px-2 text-xs font-medium"
                    title="切换对话 / 写作模式"
                    aria-label={`当前${MODE_LABELS[mode]}模式，点击切换`}
                    disabled={disabled}
                >
                    <ModeIcon />
                    {MODE_LABELS[mode]}
                    <ChevronDown className="size-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel>对话模式</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {MODES.map((item) => {
                    const ItemIcon = MODE_ICONS[item]
                    return (
                        <DropdownMenuItem key={item} onSelect={() => onChange(item)}>
                            <ItemIcon />
                            {MODE_LABELS[item]}
                            {item === mode ? <Check className="ml-auto size-3" /> : null}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
