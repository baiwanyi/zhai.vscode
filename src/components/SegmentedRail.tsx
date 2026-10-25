/**
 * 分段切换栏：横向「图标 + 文字」的单选分段，设定分组、快照分区、取名条件、角色属性共用同一形态。
 * 复用约定：底层取 @components/ui 的 toggle-group（单选单值），图标为任意接受 className 的组件，
 * 未提供图标时只渲染文字；variant 区分「主色块高亮」「连体等分描边」「可换行独立胶囊」三种既有形态。
 * 关键约束：不得用 TooltipTrigger 包裹分段项——Tooltip 会向子节点注入自身 data-state，
 * 覆盖 ToggleGroup 的选中态导致高亮失效；选中值可能回传空串，须判空后再回调业务。
 */
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { JSX, ReactNode } from 'react'

/**
 * 单个分段项：value 为业务枚举值，icon 省略时仅显示文字。
 * 图标刻意收成函数签名而非 ComponentType——lucide 的 LucideIcon 是 ForwardRefExoticComponent，
 * 属于「可调用的渲染函数」而非 FunctionComponent，用 ComponentType 会拒收全部 lucide 图标。
 */
export interface SegmentedRailItem<T extends string> {
    value: T
    label: string
    icon?: (props: { className?: string }) => ReactNode
}

/** pill 主色块高亮、outline 连体等分描边、chip 独立描边胶囊 */
export type SegmentedRailVariant = 'pill' | 'outline' | 'chip'

export interface SegmentedRailProps<T extends string> {
    items: readonly SegmentedRailItem<T>[]
    value: T
    onChange: (value: T) => void
    ariaLabel: string
    variant?: SegmentedRailVariant
    /**
     * outline 形态下是否整行等分：true 时容器 w-full、分段项 flex-1（表单字段行），
     * false 时按内容宽度排布（嵌在横向 flex 行内，如姓氏输入框右侧的单姓/复姓切换）。
     */
    isStretched?: boolean
    /**
     * chip 形态下是否允许换行：true 时多行堆叠（角色、体型、性别等项数不定的标签组），
     * false 时单行排布，配合外层横向滚动使用。
     */
    isWrapped?: boolean
    /** 分段项尺寸档位：弹窗内的必选组用 lg，默认 default */
    size?: 'default' | 'sm' | 'lg'
    /** 整组禁用：提交中禁用全部选项 */
    isDisabled?: boolean
}

const PILL_CONTAINER_CLASS = 'w-full flex-wrap rounded-lg bg-muted p-1'

const PILL_ITEM_CLASS =
    'h-8 gap-1 px-2 text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground'

interface RailClassNames {
    container: string | undefined
    item: string | undefined
}

/** 三种形态的容器与分段项类名在这里集中决定，调用方只选语义不拼样式 */
function resolveClassNames(
    variant: SegmentedRailVariant,
    isStretched: boolean,
    isWrapped: boolean,
): RailClassNames {
    if (variant === 'pill') {
        return { container: PILL_CONTAINER_CLASS, item: PILL_ITEM_CLASS }
    }
    if (variant === 'chip') {
        return { container: isWrapped ? 'flex-wrap' : undefined, item: undefined }
    }
    return { container: isStretched ? 'w-full' : undefined, item: isStretched ? 'flex-1' : undefined }
}

export function SegmentedRail<T extends string>({
    items,
    value,
    onChange,
    ariaLabel,
    variant = 'pill',
    isStretched = true,
    isWrapped = true,
    size = 'default',
    isDisabled = false,
}: SegmentedRailProps<T>): JSX.Element {
    const classNames = resolveClassNames(variant, isStretched, isWrapped)

    return (
        <ToggleGroup
            type="single"
            spacing={variant === 'pill' ? 1 : variant === 'chip' ? 2 : 0}
            variant={variant === 'outline' ? 'outline' : undefined}
            size={size}
            disabled={isDisabled}
            value={value}
            onValueChange={(next) => {
                if (next.length > 0) {
                    onChange(next as T)
                }
            }}
            aria-label={ariaLabel}
            className={classNames.container}
        >
            {items.map((item) => {
                const Icon = item.icon
                return (
                    <ToggleGroupItem
                        key={item.value}
                        value={item.value}
                        variant={variant === 'chip' ? 'outline' : undefined}
                        aria-label={item.label}
                        className={classNames.item}
                    >
                        {Icon ? <Icon className="size-4" /> : null}
                        {item.label}
                    </ToggleGroupItem>
                )
            })}
        </ToggleGroup>
    )
}
