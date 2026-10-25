/**
 * 生图比例选择：底部操作行的比例菜单，把全部可选比例收进一个触发器。
 * 复用约定：外壳取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button，
 * 可选比例取 @shared/types/imagegen 的 IMAGE_RATIOS（与宿主校验同一份清单），类名合并用 cn。
 * 关键约束：当前比例在下拉里整行高亮并在行尾打勾；生成中整体禁用，避免在途请求期间改参数；
 * 触发器给比例符号图标加当前取值（取值本身比图标精确），下拉项只给文字；
 * 本组件只上抛目标比例，落盘由输入卡片承担。
 */
import { cn } from 'cn'
import { Check, ChevronDown, Ratio } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { IMAGE_RATIOS, type ImageRatio } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface ImageRatioSelectorProps {
    /** 当前比例：既决定触发器文案，也决定下拉里的高亮项 */
    ratio: ImageRatio
    /** 生成中禁用：在途请求期间不改参数，避免结果与界面上的比例对不上 */
    disabled: boolean
    onChange: (ratio: ImageRatio) => void
}

export function ImageRatioSelector({ ratio, disabled, onChange }: ImageRatioSelectorProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="font-medium bg-white/5 text-foreground hover:bg-white/5 dark:hover:bg-white/5"
                    aria-label={`当前比例 ${ratio}，点击切换`}
                    disabled={disabled}
                >
                    <Ratio />
                    {ratio}
                    <ChevronDown className="size-3 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-24">
                {IMAGE_RATIOS.map((item) => {
                    const isActive = item === ratio
                    return (
                        <DropdownMenuItem
                            key={item}
                            onSelect={() => onChange(item)}
                            className={cn('py-1.5', isActive ? 'bg-foreground/10' : '')}
                        >
                            <span>{item}</span>
                            {isActive ? <Check className="ml-auto size-3.5" /> : null}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
