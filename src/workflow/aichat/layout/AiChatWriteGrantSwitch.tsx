/**
 * 写入范围切换：声明本轮可写到哪里，在「仅当前文档」与「整个作品」之间切换。
 * 复用 @components/ui 的 DropdownMenu 与 @webview/components/Button；当前范围整行高亮并在名称后带勾选。
 * 关键约束：范围只影响宿主下发的写入工具白名单，不改动已生成的消息，也不中断在途生成；
 * 本组件只上抛目标范围，持久化由会话 hook 承担；默认范围由宿主新建会话时决定（仅当前文档），
 * 组件里不得再写死默认值，否则展示与实际授权会分叉。
 */
import { cn } from 'cn'
import { Check, ChevronDown, FileText, FolderOpen, Info } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import type { AiWriteGrant } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 范围展示文案 */
const GRANT_LABELS: Record<AiWriteGrant, string> = {
    document: '仅当前文档',
    project: '整个作品',
}

/** 范围图标 */
const GRANT_ICONS: Record<AiWriteGrant, LucideIcon> = {
    document: FileText,
    project: FolderOpen,
}

/** 范围说明：菜单项右侧信息图标用原生 tooltip 解释差异 */
const GRANT_HINTS: Record<AiWriteGrant, string> = {
    document: '只改写发送时选中的这篇文档，无选区时取整篇',
    project: '可读写整个作品目录，适合连续生成章节',
}

/** 菜单展示顺序：由窄到宽 */
const GRANTS: readonly AiWriteGrant[] = ['document', 'project']

interface AiChatWriteGrantSwitchProps {
    grant: AiWriteGrant
    disabled: boolean
    onChange: (grant: AiWriteGrant) => void
}

export function AiChatWriteGrantSwitch({ grant, disabled, onChange }: AiChatWriteGrantSwitchProps): JSX.Element {
    const GrantIcon = GRANT_ICONS[grant]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="font-medium"
                    aria-label={`当前写入范围：${GRANT_LABELS[grant]}，点击切换`}
                    disabled={disabled}
                >
                    <GrantIcon />
                    {GRANT_LABELS[grant]}
                    <ChevronDown className="size-3 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                {GRANTS.map((item) => {
                    const ItemIcon = GRANT_ICONS[item]
                    const isActive = item === grant
                    return (
                        <DropdownMenuItem
                            key={item}
                            onSelect={() => onChange(item)}
                            className={cn('gap-2.5 py-2', isActive ? 'bg-foreground/10' : '')}
                        >
                            <ItemIcon className="size-4" />
                            <span>{GRANT_LABELS[item]}</span>
                            {isActive ? <Check className="ml-auto size-3.5" /> : null}
                            <span
                                className={cn('flex shrink-0', isActive ? 'ml-1' : 'ml-auto')}
                                title={GRANT_HINTS[item]}
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
