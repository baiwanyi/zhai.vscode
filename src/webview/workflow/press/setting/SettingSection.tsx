/**
 * 设定分组卡：把作品设定页的字段按「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格」折叠收纳。
 * 复用约定：卡片外壳复用 ui/card（sm 尺寸），折叠交互复用 ui/collapsible，标题行复用 ui/button 的 ghost 变体，
 * 内容区上沿分隔复用 ui/separator，缺项标记复用 ui/badge 的 outline 变体。
 * 关键约束：展开状态由父级受控，页面才能在执行「补齐缺失项」时直接展开对应分组；
 * 折叠标题整行可点，但内部的缺项徽标不承担点击语义，避免一次点击触发两次状态变化。
 */
import { cn } from 'cn'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { Separator } from '@components/ui/separator'
import type { JSX, ReactNode } from 'react'

interface SettingSectionProps {
    title: string
    /** 分组一句话说明，窄容器下隐藏 */
    description: string
    /** 该分组是否仍有未填写的关键字段 */
    isIncomplete: boolean
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    children: ReactNode
}

export function SettingSection({
    title,
    description,
    isIncomplete,
    isOpen,
    onOpenChange,
    children,
}: SettingSectionProps): JSX.Element {
    return (
        <Card size="sm" className="gap-0 py-0">
            <Collapsible open={isOpen} onOpenChange={onOpenChange}>
                <CollapsibleTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2 rounded-xl px-3 py-2 text-left"
                    >
                        <ChevronRight
                            className={cn(
                                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                isOpen && 'rotate-90',
                            )}
                            aria-hidden="true"
                        />
                        <span className="shrink-0">{title}</span>
                        {isIncomplete ? (
                            <Badge variant="outline" className="shrink-0 text-muted-foreground">
                                待补充
                            </Badge>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-right font-normal text-muted-foreground">
                            {description}
                        </span>
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <Separator />
                    <div className="flex flex-col gap-3 px-3 py-3">{children}</div>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    )
}
