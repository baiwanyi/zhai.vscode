/**
 * AI 对话参考资料菜单：顶部工具行右侧的「参考」按钮，当前四项均为占位。
 * 复用 @/components/ui 的 DropdownMenu 与 Badge、../constants 的参考源清单。
 * 关键约束：占位项不发起任何宿主请求，仅通过回调提示「即将上线」，后续置 enabled 即可接入。
 */
import { BookOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AiReferenceSource } from '../constants'
import type { JSX } from 'react'
import { AI_REFERENCE_SOURCES } from '../constants'

interface AiChatReferenceMenuProps {
    disabled: boolean
    onSelect: (source: AiReferenceSource) => void
}

export function AiChatReferenceMenu({ disabled, onSelect }: AiChatReferenceMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-muted-foreground"
                    title="参考资料"
                    aria-label="参考资料"
                    disabled={disabled}
                >
                    <BookOpen />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>参考资料</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {AI_REFERENCE_SOURCES.map((source) => (
                    <DropdownMenuItem
                        key={source.kind}
                        onSelect={() => onSelect(source)}
                        className="flex-col items-start gap-0.5"
                    >
                        <span className="flex w-full items-center justify-between gap-2">
                            <span className="truncate">{source.title}</span>
                            {source.enabled ? null : (
                                <Badge variant="secondary" className="shrink-0 font-normal">
                                    即将上线
                                </Badge>
                            )}
                        </span>
                        <span className="w-full truncate text-xs text-muted-foreground">{source.description}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
