/**
 * AI 对话模型菜单：底部操作行展示当前模型，展开时才拉取账号可用清单。
 * 复用 @components/ui 的 DropdownMenu，把「默认模型」「清单项」「手动输入」合并为同一菜单。
 * 关键约束：清单拉取需拉起 CLI（数秒），加载中禁止重复选择；手动输入交给宿主输入框，本层只上抛 manual 标记；
 * 顶部展示立即使用运行时带回的模型 id，未匹配到清单项时退回展示 id 本身。
 */
import { Check, ChevronDown, Cpu, Loader2, Pencil } from 'lucide-react'
import { Button } from '@components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { AiModelChoices, AiModelOption } from '@shared/types/aiChat'
import type { JSX } from 'react'

/** 空模型 id 表示交给 CLI 选择默认模型 */
const DEFAULT_MODEL_ID = ''
const DEFAULT_MODEL_LABEL = '默认模型'

interface AiChatModelMenuProps {
    /** 当前模型 id，空表示使用默认模型 */
    current: string
    /** 菜单数据：未展开过时为 null */
    choices: AiModelChoices | null
    isLoading: boolean
    disabled: boolean
    /** 菜单展开时按需拉取清单 */
    onOpen: () => void
    onSelect: (modelId: string, manual: boolean) => void
}

export function AiChatModelMenu({
    current,
    choices,
    isLoading,
    disabled,
    onOpen,
    onSelect,
}: AiChatModelMenuProps): JSX.Element {
    const options = choices?.options ?? []
    const currentOption = options.find((option) => option.modelId === current)
    const currentLabel = currentOption?.name ?? (current.length > 0 ? current : DEFAULT_MODEL_LABEL)

    const renderOption = (option: AiModelOption): JSX.Element => (
        <DropdownMenuItem
            key={option.modelId}
            onSelect={() => onSelect(option.modelId, false)}
            className="flex-col items-start gap-0.5"
        >
            <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{option.name}</span>
                {option.modelId === current ? <Check className="size-3 shrink-0" /> : null}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{option.modelId}</span>
        </DropdownMenuItem>
    )

    return (
        <DropdownMenu onOpenChange={(open) => (open ? onOpen() : undefined)}>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="ghost"
                    className="min-w-0 max-w-32 gap-1 rounded-lg px-1.5 text-xs font-normal text-muted-foreground"
                    title={`当前模型：${currentLabel}`}
                    aria-label={`当前模型 ${currentLabel}，点击切换`}
                    disabled={disabled}
                >
                    <Cpu />
                    <span className="min-w-0 truncate">{currentLabel}</span>
                    {isLoading ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <ChevronDown className="size-3 shrink-0" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>模型</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSelect(DEFAULT_MODEL_ID, false)}>
                    <Cpu />
                    {DEFAULT_MODEL_LABEL}
                    {current === DEFAULT_MODEL_ID ? <Check className="ml-auto size-3" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {options.length > 0 ? (
                    options.map(renderOption)
                ) : (
                    <DropdownMenuItem disabled>
                        {isLoading ? '正在读取可用模型…' : '未读取到可用模型，可手动输入'}
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSelect(DEFAULT_MODEL_ID, true)}>
                    <Pencil />
                    手动输入模型 id…
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
