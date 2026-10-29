/**
 * 审批模式切换：写作模式下决定写入是否逐次确认，在「逐次确认」与「自动放行」之间切换。
 * 复用 @components/ui 的 DropdownMenu 与 @webview/components/Button；当前模式整行高亮并在名称后带勾选。
 * 关键约束：只影响宿主侧工具守卫的策略位，不切换 SDK 权限模式 —— 后者会让编辑类工具绕过路径校验；
 * 切到逐次确认后每次写入都会弹窗等待，连续生成章节时建议保持自动放行。
 */
import { cn } from 'cn'
import { Check, ChevronDown, Info, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import type { AiApprovalMode } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 模式展示文案 */
const APPROVAL_LABELS: Record<'ask' | 'auto', string> = {
    ask: '逐次确认',
    auto: '自动放行',
}

/** 模式图标 */
const APPROVAL_ICONS: Record<'ask' | 'auto', LucideIcon> = {
    ask: ShieldQuestion,
    auto: ShieldCheck,
}

/** 模式说明：菜单项右侧信息图标用原生 tooltip 解释差异 */
const APPROVAL_HINTS: Record<'ask' | 'auto', string> = {
    ask: '每次写入都弹窗确认，适合精修单章',
    auto: '白名单范围内直接写入，适合连续生成章节',
}

/** 菜单展示顺序：由严到宽 */
const APPROVALS: readonly ('ask' | 'auto')[] = ['ask', 'auto']

interface AiChatApprovalSwitchProps {
    approval: AiApprovalMode
    disabled: boolean
    onChange: (approval: AiApprovalMode) => void
}

export function AiChatApprovalSwitch({ approval, disabled, onChange }: AiChatApprovalSwitchProps): JSX.Element {
    // 只读是对话模式独占的档位，写作模式下按自动放行展示，避免出现无法切回的空白触发器
    const current: 'ask' | 'auto' = approval === 'ask' ? 'ask' : 'auto'
    const CurrentIcon = APPROVAL_ICONS[current]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="font-medium"
                    aria-label={`当前审批模式：${APPROVAL_LABELS[current]}，点击切换`}
                    disabled={disabled}
                >
                    <CurrentIcon />
                    {APPROVAL_LABELS[current]}
                    <ChevronDown className="size-3 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                {APPROVALS.map((item) => {
                    const ItemIcon = APPROVAL_ICONS[item]
                    const isActive = item === current
                    return (
                        <DropdownMenuItem
                            key={item}
                            onSelect={() => onChange(item)}
                            className={cn('gap-2.5 py-2', isActive ? 'bg-foreground/10' : '')}
                        >
                            <ItemIcon className="size-4" />
                            <span>{APPROVAL_LABELS[item]}</span>
                            {isActive ? <Check className="ml-auto size-3.5" /> : null}
                            <span
                                className={cn('flex shrink-0', isActive ? 'ml-1' : 'ml-auto')}
                                title={APPROVAL_HINTS[item]}
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
