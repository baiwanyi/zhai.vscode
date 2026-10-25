/**
 * 提示词面板：左侧分类、右侧词条按钮网格，点击词条把文本插入输入框光标处。
 * 复用约定：Popover 取 @components/ui/popover，按钮与滚动区取 @webview/components/Button、scroll-area；
 * 分类与词条清单来自 prompt/ 下的 promptLibrary，本组件只负责选择与回调。
 * 关键约束：插入不替换已有内容、不去重，允许连续点击累加；面板自身不持有输入框状态。
 */
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'
import { PROMPT_CATEGORIES, PROMPT_ITEMS } from '../prompt/promptLibrary'

interface ImagePromptPopoverProps {
    /** 触发按钮：由调用方决定外观，保持工具栏风格统一 */
    trigger: ReactNode
    /** 词条插入回调：调用方负责写入光标位置 */
    onInsert: (text: string) => void
}

export function ImagePromptPopover({ trigger, onInsert }: ImagePromptPopoverProps): JSX.Element {
    const [activeCategory, setActiveCategory] = useState(PROMPT_CATEGORIES[0]?.id ?? '')
    const items = PROMPT_ITEMS.filter((item) => item.category === activeCategory)

    return (
        <Popover>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" className="w-130 p-0">
                <div className="flex max-h-80">
                    <div className="w-32 shrink-0 border-r p-1.5">
                        {PROMPT_CATEGORIES.map((category) => {
                            const Icon = category.icon
                            const isActive = category.id === activeCategory
                            return (
                                <Button
                                    key={category.id}
                                    size="sm"
                                    variant="ghost"
                                    className={`mb-0.5 w-full justify-start ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                                    onClick={() => setActiveCategory(category.id)}
                                >
                                    <Icon className="size-4" />
                                    {category.label}
                                </Button>
                            )
                        })}
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto p-2">
                        {items.map((item) => (
                            <Button
                                key={item.id}
                                size="sm"
                                variant="outline"
                                className="h-7 justify-start overflow-hidden text-xs"
                                title={item.text}
                                onClick={() => onInsert(item.text)}
                            >
                                <span className="truncate">{item.title}</span>
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="border-t px-2.5 py-1.5 text-xs text-muted-foreground">
                    点击插入到光标处，可连续点击累加
                </div>
            </PopoverContent>
        </Popover>
    )
}
