/**
 * AI 对话模型菜单：底部操作行展示当前模型，展开时才拉取账号可用清单。
 * 复用 @components/ui 的 DropdownMenu，把「Auto」「内置模型」「自定义模型」合并为同一菜单；
 * 每项左侧图标由 ./ModelIcon 按模型 id 前缀提供（品牌 SVG，缺失时回退品牌色首字母胶囊）。
 * 关键约束：清单拉取需拉起 CLI（数秒），加载中禁止重复选择；Auto 与「空模型 id」一一对应，
 * 选中即交给平台自动选择模型；本层不提供手动输入，模型 id 只来自清单。
 * 清单项右侧展示平台下发的额度倍率（每个模型的成本消耗速率），勾选位于倍率之前，倍率未知时不渲染；
 * 两组清单均按展示名字母序排列（numeric 比较），Auto 固定在内置组首位；
 * 触发器完整展示当前模型名、不截断，颜色取正文前景色而不是弱化色；
 * 清单未拉取或未命中时用运行时带回的 currentName 兜底，避免初始化阶段闪出裸模型 id；
 * 当前模型下发可选档位时，菜单底部追加「上下文窗口」组（含「模型默认」），档位值由平台清单给出。
 */
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Spinner } from '@components/ui/spinner'
import type { AiModelChoices, AiModelOption } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import { ModelIcon } from './ModelIcon'
import type { JSX } from 'react'

/** 空模型 id 表示交给平台自动选择模型 */
const AUTO_MODEL_ID = ''
const AUTO_MODEL_LABEL = 'Auto'

/** 额度倍率展示文本：未知返回 null，避免把「未知」渲染成零成本 */
function toRateLabel(rate: number | null): string | null {
    return rate === null ? null : `${rate.toFixed(2)}x`
}

/** 按展示名字母序排列：numeric 让 V4.1 排在 V4 之后，避免数字段被逐字符比较 */
function sortByName(list: AiModelOption[]): AiModelOption[] {
    return [...list].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
    )
}

/** 档位展示文本：平台档位均为整千/整百万，折成 300K / 1M，不保留无意义小数 */
function toWindowLabel(tokens: number): string {
    if (tokens >= 1_000_000) {
        return `${Number((tokens / 1_000_000).toFixed(1))}M`
    }
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens)
}

interface AiChatModelMenuProps {
    /** 当前模型 id，空表示使用自动模型 */
    current: string
    /** 当前模型展示名（运行时提供）：清单未拉取或未命中时用于替代裸 id */
    currentName: string
    /** 菜单数据：未展开过时为 null */
    choices: AiModelChoices | null
    isLoading: boolean
    disabled: boolean
    /** 菜单展开时按需拉取清单 */
    onOpen: () => void
    onSelect: (modelId: string, manual: boolean) => void
    /** 选择上下文档位：0 表示跟随模型默认 */
    onSelectContextWindow: (tokens: number) => void
}

export function AiChatModelMenu({
    current,
    currentName,
    choices,
    isLoading,
    disabled,
    onOpen,
    onSelect,
    onSelectContextWindow,
}: AiChatModelMenuProps): JSX.Element {
    const options = choices?.options ?? []
    const builtinOptions = sortByName(options.filter((option) => !option.custom))
    const customOptions = sortByName(options.filter((option) => option.custom))
    const currentOption = options.find((option) => option.modelId === current)
    const windowOptions = currentOption?.contextWindowOptions ?? []
    const selectedWindow = choices?.contextWindow ?? 0
    // 切换模型后旧档位可能不在新模型的可选范围内：此时按「模型默认」呈现，与宿主实际下发的值一致
    const currentWindow = windowOptions.includes(selectedWindow) ? selectedWindow : 0
    const defaultWindow = currentOption?.contextWindowTokens ?? 0
    const isAuto = current === AUTO_MODEL_ID
    const currentLabel = isAuto
        ? AUTO_MODEL_LABEL
        : (currentOption?.name ?? (currentName.length > 0 ? currentName : current))

    const renderAutoOption = (): JSX.Element => (
        <DropdownMenuItem onSelect={() => onSelect(AUTO_MODEL_ID, false)} className="gap-2">
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{AUTO_MODEL_LABEL}</span>
            {isAuto ? <Check className="size-3 shrink-0" /> : null}
        </DropdownMenuItem>
    )

    const renderOption = (option: AiModelOption): JSX.Element => {
        const rateLabel = toRateLabel(option.creditRate)
        return (
            <DropdownMenuItem key={option.modelId} onSelect={() => onSelect(option.modelId, false)} className="gap-2">
                <ModelIcon modelId={option.modelId} name={option.name} />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                    {option.modelId === current ? <Check className="size-3 shrink-0" /> : null}
                    {rateLabel !== null ? (
                        <span className="tabular-nums text-muted-foreground">{rateLabel}</span>
                    ) : null}
                </span>
            </DropdownMenuItem>
        )
    }

    /** 档位项：0 为「模型默认」，其余为平台下发的可选档位 */
    const renderWindowOption = (tokens: number, label: string): JSX.Element => (
        <DropdownMenuItem key={tokens} onSelect={() => onSelectContextWindow(tokens)} className="gap-2">
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {currentWindow === tokens ? <Check className="size-3 shrink-0" /> : null}
        </DropdownMenuItem>
    )

    return (
        <DropdownMenu onOpenChange={(open) => (open ? onOpen() : undefined)}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="shrink-0 gap-1 items-center text-foreground font-normal"
                    aria-label={`当前模型 ${currentLabel}，点击切换`}
                    disabled={disabled}
                >
                    {isAuto ? (
                        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                        <ModelIcon modelId={current} name={currentLabel} />
                    )}
                    <span className="whitespace-nowrap">{currentLabel}</span>
                    {isLoading ? (
                        <Spinner className="size-3 shrink-0" aria-label="正在读取可用模型" />
                    ) : (
                        <ChevronDown className="size-3 shrink-0" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
                {/* 滚动交给内层：外层不滚动，毛玻璃底色与描边才不会随内容滚出可视区（否则下半截发透）；
                    overflow-x-hidden 必需——分隔线带 -mx-1，会超出内层宽度 8px，而 overflow-y-auto 会把
                    水平方向一并变成 auto，不裁剪就会出现水平滚动条 */}
                <div className="max-h-72 overflow-x-hidden overflow-y-auto">
                    <DropdownMenuLabel>内置模型</DropdownMenuLabel>
                    {renderAutoOption()}
                    {builtinOptions.length > 0 ? (
                        builtinOptions.map(renderOption)
                    ) : (
                        <DropdownMenuItem disabled>
                            {isLoading ? '正在读取可用模型…' : '未读取到可用模型'}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>自定义模型</DropdownMenuLabel>
                    {customOptions.length > 0 ? (
                        customOptions.map(renderOption)
                    ) : (
                        <DropdownMenuItem disabled>暂无自定义模型</DropdownMenuItem>
                    )}
                    {/* 档位只在平台下发可选长度时出现：Auto 与未上报能力的自定义模型没有可选项 */}
                    {windowOptions.length > 0 ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>上下文窗口</DropdownMenuLabel>
                            {renderWindowOption(
                                0,
                                defaultWindow > 0 ? `模型默认（${toWindowLabel(defaultWindow)}）` : '模型默认',
                            )}
                            {windowOptions.map((tokens) => renderWindowOption(tokens, toWindowLabel(tokens)))}
                        </>
                    ) : null}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
