/**
 * 画面风格选择：工具栏的图标按钮弹出单选面板，用「缩略图 + 文案」的卡片展示全部画风。
 * 复用约定：Popover 取 @components/ui/popover，单选语义取 @components/ui/radio-group（卡片即 Label 包裹，
 * 点整卡即选中），画风清单与标签取 prompt/imageStyle 的 STYLE_OPTIONS（与宿主 STYLE_HINTS 同源）。
 * 关键约束：触发器是图标按钮，可访问名与提示由 aria-label / tooltip 承担（依赖挂载器的 TooltipProvider）；
 * 选中即收盘并回调，不提供「不选」——画风始终有一项生效（默认 auto）；
 * 卡片缩略图是按画风配的渐变示意，不引入图片资源；生成中整体禁用，避免在途请求期间改参数。
 */
import { cn } from 'cn'
import { Palette } from 'lucide-react'
import { useState } from 'react'
import { Label } from '@components/ui/label'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@components/ui/radio-group'
import type { PortraitStyle } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { STYLE_OPTIONS } from '../prompt/imageStyle'

/** 缩略图色板：用渐变示意各画风的冷暖与质感，当作风格预览图使用 */
const STYLE_SWATCH: Record<PortraitStyle, string> = {
    auto: 'from-muted-foreground/35 via-muted-foreground/15 to-transparent',
    guofeng: 'from-amber-700/70 via-amber-500/40 to-stone-200/30',
    anime: 'from-sky-500/70 via-pink-400/50 to-violet-300/40',
    realistic: 'from-stone-700/70 via-stone-400/40 to-stone-200/30',
    photo: 'from-neutral-800/70 via-neutral-400/40 to-neutral-200/30',
    cinematic: 'from-slate-900/80 via-indigo-700/50 to-amber-500/40',
    gameart: 'from-fuchsia-600/70 via-purple-500/40 to-cyan-300/40',
    pixel: 'from-emerald-600/70 via-lime-400/40 to-yellow-200/40',
}

interface ImageStylePickerProps {
    /** 当前生效的画风：来自输入卡片的风格芯片，缺省时为作品默认画风 */
    value: PortraitStyle
    /** 生成中禁用：在途请求期间不改参数 */
    disabled: boolean
    /** 选中回调：同时给出取值与标签，由输入卡片写回芯片与作品配置 */
    onChange: (value: PortraitStyle, label: string) => void
}

export function ImageStylePicker({ value, disabled, onChange }: ImageStylePickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)

    /** 选中即收盘：面板只是选择的载体，选完不需要停留 */
    const handleValueChange = (next: string): void => {
        const option = STYLE_OPTIONS.find((item) => item.value === next)
        if (option === undefined) {
            return
        }
        onChange(option.value, option.label)
        setIsOpen(false)
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="画面风格" tooltip="画面风格" disabled={disabled}>
                    <Palette />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start">
                <PopoverHeader>
                    <PopoverTitle>画面风格</PopoverTitle>
                </PopoverHeader>
                <RadioGroup value={value} onValueChange={handleValueChange} className="grid grid-cols-4 gap-1.5">
                    {STYLE_OPTIONS.map((option) => {
                        const isActive = option.value === value
                        return (
                            <Label
                                key={option.value}
                                className={cn(
                                    'relative flex cursor-pointer flex-col items-stretch gap-1 rounded-lg p-1 ring-1 transition-colors',
                                    isActive ? 'bg-secondary ring-primary/40' : 'ring-transparent hover:bg-muted/60',
                                )}
                            >
                                <RadioGroupItem
                                    value={option.value}
                                    className="absolute top-1.5 right-1.5 size-3.5 bg-background/80"
                                />
                                <span
                                    aria-hidden
                                    className={cn('h-11 w-full rounded-md bg-linear-to-br', STYLE_SWATCH[option.value])}
                                />
                                <span
                                    className={cn(
                                        'w-full truncate text-center text-[11px] leading-4',
                                        isActive ? 'text-foreground' : 'text-muted-foreground',
                                    )}
                                >
                                    {option.label}
                                </span>
                            </Label>
                        )
                    })}
                </RadioGroup>
            </PopoverContent>
        </Popover>
    )
}
