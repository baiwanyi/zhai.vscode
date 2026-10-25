/**
 * 提示词选择：工具栏的图标按钮弹出面板，左侧分类、右侧词条按钮网格，点击词条把文本插入输入框光标处。
 * 复用约定：Popover 取 @components/ui/popover，分类单选取 @components/ui/toggle-group（竖向），
 * 词条按钮取 @webview/components/Button；分类与词条清单来自 prompt/ 下的 promptLibrary，本组件只负责选择与回调。
 * 关键约束：触发器是图标按钮，可访问名与提示由 aria-label / tooltip 承担（依赖挂载器的 TooltipProvider）；
 * 分类为必选单选，重复点击已选项时 Radix 会回传空串，须判空后再落状态；
 * 插入不替换已有内容、不去重，允许连续点击累加；面板自身不持有输入框状态。
 */
import { WandSparkles } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { PROMPT_CATEGORIES, PROMPT_ITEMS } from '../prompt/promptLibrary'

interface ImagePromptPickerProps {
    /** 词条插入回调：调用方负责写入光标位置 */
    onInsert: (text: string) => void
}

export function ImagePromptPicker({ onInsert }: ImagePromptPickerProps): JSX.Element {
    const [activeCategory, setActiveCategory] = useState(PROMPT_CATEGORIES[0]?.id ?? '')
    const items = PROMPT_ITEMS.filter((item) => item.category === activeCategory)

    /** 分类是必选单选：Radix 允许再点一次取消、回传空串，判空丢弃以保持始终有一类生效 */
    const handleCategoryChange = (next: string): void => {
        if (next.length > 0) {
            setActiveCategory(next)
        }
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="提示词" tooltip="提示词">
                    <WandSparkles />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-130">
                <PopoverHeader>
                    <PopoverTitle>提示词</PopoverTitle>
                </PopoverHeader>
                <div className="flex max-h-80 gap-3">
                    <ToggleGroup
                        type="single"
                        orientation="vertical"
                        spacing={0.5}
                        value={activeCategory}
                        onValueChange={handleCategoryChange}
                        aria-label="提示词分类"
                        className="bg-muted p-2"
                    >
                        {PROMPT_CATEGORIES.map((category) => {
                            const Icon = category.icon
                            return (
                                <ToggleGroupItem
                                    key={category.id}
                                    value={category.id}
                                    className="text-muted-foreground hover:bg-white/5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                >
                                    <Icon className="size-4" />
                                    {category.label}
                                </ToggleGroupItem>
                            )
                        })}
                    </ToggleGroup>
                    <div className="grid min-w-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto">
                        {items.map((item) => (
                            <Button key={item.id} size="sm" variant="outline" onClick={() => onInsert(item.text)}>
                                <span className="truncate">{item.title}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
