/**
 * 勾选行：回填差异、伏笔建议与回收、节拍清单共用的 Item 骨架，统一勾选按钮、媒体位对齐与徽标区。
 * 复用约定：结构取 shadcn ItemGroup/Item，勾选按钮取 components/Button 的 ghost icon 变体；
 * 标题与描述由调用方以 props 传入，操作区以 children 传入，行样式与变体由调用方配置，本组件只负责勾选语义。
 * 关键约束：aria-pressed 必须随 isSelected 变化供读屏识别；媒体位用含描述的变体选择器覆盖 item 的 self-start，
 * 保证按钮在两行内容下垂直居中；onClick 只上报切换，不在此写盘。
 */
import { cn } from 'cn'
import { CheckSquare, Square } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import type { ComponentProps, JSX, ReactNode } from 'react'

export interface ToggleCheckItemProps {
    isSelected: boolean
    title: ReactNode
    description?: ReactNode
    /** 描述超长时单行截断，默认保留可换行的 flex 布局 */
    isTruncate?: boolean
    children?: ReactNode
    ariaLabel: string
    /** 行容器附加类名：供调用方覆盖边框、间距与 group 等布局样式 */
    className?: string
    /** 行视觉变体：默认 outline，取值同 shadcn Item */
    variant?: NonNullable<ComponentProps<typeof Item>['variant']>
    onToggle: () => void
}

export function ToggleCheckItem({
    isSelected,
    title,
    description,
    isTruncate = false,
    children,
    ariaLabel,
    className,
    variant = 'outline',
    onToggle,
}: ToggleCheckItemProps): JSX.Element {
    return (
        <Item size="xs" variant={variant} className={cn('group flex-nowrap', className)}>
            <ItemMedia
                variant="icon"
                className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-full"
                    aria-label={ariaLabel}
                    aria-pressed={isSelected}
                    onClick={onToggle}
                >
                    {isSelected ? (
                        <CheckSquare className="text-chart-2" aria-hidden="true" />
                    ) : (
                        <Square aria-hidden="true" />
                    )}
                </Button>
            </ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="w-auto min-w-0 flex-1">{title}</ItemTitle>
                {description === undefined ? null : (
                    <ItemDescription className={cn('flex items-center gap-1', isTruncate && 'line-clamp-1')}>
                        {description}
                    </ItemDescription>
                )}
            </ItemContent>
            {children === undefined ? null : <ItemActions className="shrink-0">{children}</ItemActions>}
        </Item>
    )
}
