/**
 * 回填勾选行：三处差异/建议/回收清单共用的 Item 骨架，统一勾选按钮、媒体位对齐与徽标区。
 * 复用约定：结构取 shadcn ItemGroup/Item，勾选按钮取 components/Button 的 ghost icon 变体；
 * 标题、描述与操作区由调用方以 JSX 传入，本组件只负责勾选语义与固定样式。
 * 关键约束：aria-pressed 必须随 isSelected 变化供读屏识别；媒体位用 important 覆盖 item 在含描述时的 self-start，
 * 保证按钮在两行内容下垂直居中；onClick 只上报切换，不在此写盘。
 */
import { CheckSquare, Square } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'

export interface ToggleCheckItemProps {
    isSelected: boolean
    title: ReactNode
    description?: ReactNode
    descriptionClassName?: string
    actions?: ReactNode
    ariaLabel: string
    onToggle: () => void
}

export function ToggleCheckItem({
    isSelected,
    title,
    description,
    descriptionClassName = 'flex items-center gap-1',
    actions,
    ariaLabel,
    onToggle,
}: ToggleCheckItemProps): JSX.Element {
    return (
        <Item size="xs" variant="outline" className="flex-nowrap">
            <ItemMedia variant="icon" className="translate-y-0! self-center!">
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
                    <ItemDescription className={descriptionClassName}>{description}</ItemDescription>
                )}
            </ItemContent>
            {actions === undefined ? null : <ItemActions className="shrink-0">{actions}</ItemActions>}
        </Item>
    )
}
