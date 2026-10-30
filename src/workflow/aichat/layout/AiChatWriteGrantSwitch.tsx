/**
 * 写入范围切换：声明本轮可写到哪里，在「当前文档」与「整个作品」之间切换。
 * 复用 @components/ui 的 DropdownMenu，按钮取 @webview/components/Button；当前范围整行高亮并在名称后带勾选，
 * 范围差异说明收敛为菜单项右侧的信息胶囊（StatBadge，悬停暗底气泡，与工具栏提示同色）。
 * 关键约束：范围只影响宿主下发的写入工具白名单，不改动已生成的消息，也不中断在途生成；
 * 本组件只上抛目标范围，持久化由会话 hook 承担；默认范围由宿主新建会话时决定（仅当前文档），
 * 组件里不得再写死默认值，否则展示与实际授权会分叉。
 */
import { cn } from 'cn'
import { Check, ChevronDown, FileTerminal, FolderMinus, Info } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { AiWriteGrant } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import { StatBadge } from '@webview/components/StatBadge'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 单个写入范围的展示信息 */
interface GrantOption {
    label: string
    icon: LucideIcon
    /** 菜单项右侧信息胶囊的悬停气泡：一句话说清该范围到底能动哪里 */
    hint: string
}

/** 范围展示信息：文案、图标与说明集中在同一张表，新增范围只在这补一处 */
const GRANT_OPTIONS: Record<AiWriteGrant, GrantOption> = {
    document: {
        label: '当前文档',
        icon: FileTerminal,
        hint: '只改写发送时选中的这篇文档，无选区时取整篇',
    },
    project: {
        label: '整个作品',
        icon: FolderMinus,
        hint: '可读写整个作品目录，适合连续生成章节',
    },
}

/** 菜单展示顺序：由窄到宽 */
const GRANT_ORDER: readonly AiWriteGrant[] = ['document', 'project']

interface AiChatWriteGrantSwitchProps {
    grant: AiWriteGrant
    disabled: boolean
    onChange: (grant: AiWriteGrant) => void
}

export function AiChatWriteGrantSwitch({ grant, disabled, onChange }: AiChatWriteGrantSwitchProps): JSX.Element {
    const current = GRANT_OPTIONS[grant]
    const GrantIcon = current.icon

    /** 菜单项：选中项加底色与勾选，右侧信息胶囊的悬停气泡给出该范围的差异 */
    const renderGrantOption = (value: AiWriteGrant): JSX.Element => {
        const option = GRANT_OPTIONS[value]
        const OptionIcon = option.icon
        const isActive = value === grant
        return (
            <DropdownMenuItem
                key={value}
                onSelect={() => onChange(value)}
                className={cn('gap-1 py-2 my-0.5', isActive && 'bg-foreground/5')}
            >
                <OptionIcon className="size-4 text-muted-foreground" />
                <span className="flex-1">{option.label}</span>
                {isActive ? <Check className="shrink-0 ml-auto size-4" /> : null}
                <StatBadge variant="ghost" tooltip={option.hint} className="ml-auto shrink-0">
                    <Info aria-hidden className="text-muted-foreground" />
                </StatBadge>
            </DropdownMenuItem>
        )
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" aria-label={`当前写入范围：${current.label}，点击切换`} disabled={disabled}>
                    <GrantIcon />
                    <span className="font-light">{current.label}</span>
                    <ChevronDown className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuLabel>写入范围</DropdownMenuLabel>
                {GRANT_ORDER.map(renderGrantOption)}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
