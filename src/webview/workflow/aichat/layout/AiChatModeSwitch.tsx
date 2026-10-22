/**
 * AI 对话模式切换：底部操作行的模式菜单，在对话与写作之间切换。
 * 复用 @components/ui 的 DropdownMenu；当前模式整行高亮并在名称后带勾选，行尾 Info 图标说明两种模式的差异。
 * 关键约束：触发器按模式换配色（对话中性底、写作主色实底），生成中整体禁用；
 * 本组件只上抛目标模式，模式持久化由会话 hook 承担。
 */
import { cn } from 'cn'
import { Check, ChevronDown, Info, MessageSquare, PenLine } from 'lucide-react'
import { Button } from '@components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
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

/** 触发器配色：对话走中性底，写作走主色实底，让当前模式在操作行里一眼可辨 */
const TRIGGER_CLASS: Record<AiConversationMode, string> = {
    chat: 'bg-white/5 text-foreground hover:bg-white/5 dark:hover:bg-white/5',
    write: 'bg-primary/50 text-primary-foreground hover:bg-primary/50  dark:hover:bg-primary/50',
}

/** 模式说明：菜单项右侧信息图标用原生 tooltip 解释差异 */
const MODE_HINTS: Record<AiConversationMode, string> = {
    chat: '多轮问答，只输出结果，不改动编辑栏正文',
    write: '围绕编辑栏正文写作，结果可写回编辑栏',
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
                    variant="ghost"
                    className={cn('font-medium', TRIGGER_CLASS[mode])}
                    aria-label={`当前${MODE_LABELS[mode]}模式，点击切换`}
                    disabled={disabled}
                >
                    <ModeIcon />
                    {MODE_LABELS[mode]}
                    <ChevronDown className="size-3 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                {MODES.map((item) => {
                    const ItemIcon = MODE_ICONS[item]
                    const isActive = item === mode
                    return (
                        <DropdownMenuItem
                            key={item}
                            onSelect={() => onChange(item)}
                            className={cn('gap-2.5 py-2', isActive ? 'bg-foreground/10' : '')}
                        >
                            <ItemIcon className="size-4" />
                            <span>{MODE_LABELS[item]}</span>
                            {isActive ? <Check className="ml-auto size-3.5" /> : null}
                            <span
                                className={cn('flex shrink-0', isActive ? 'ml-1' : 'ml-auto')}
                                title={MODE_HINTS[item]}
                            >
                                <Info className="size-3.5 text-muted-foreground" />
                            </span>
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
