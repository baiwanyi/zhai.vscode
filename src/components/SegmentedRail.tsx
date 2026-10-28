/**
 * 分段切换栏：横向「图标 + 文字」的分段选择，设定分组、快照分区、取名条件、角色属性共用同一形态。
 * 复用约定：底层取 @components/ui 的 toggle-group，默认单选单值，isMultiple 时改为多选数组；
 * 图标为任意接受 className 的组件，未提供图标时只渲染文字；variant 区分「主色块高亮」「连体等分描边」
 * 「可换行独立胶囊」三种形态，pill 与 chip 的选中态都用主色；分段项可带 hint，悬停提示固定暗底亮字。
 * 关键约束：有 hint 时 Tooltip 只能挂在 span 包裹层上，绝不能直接包 ToggleGroupItem——
 * Tooltip 会向子节点注入自身 data-state，覆盖 ToggleGroup 的选中态导致高亮失效；
 * 单选回传空串表示取消选中，须按 items 反查后再回调，多选回传的值同样要过滤成合法枚举。
 */
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { JSX, ReactNode } from 'react'

/**
 * 单个分段项：value 为业务枚举值，icon 省略时仅显示文字。
 * 图标刻意收成函数签名而非 ComponentType——lucide 的 LucideIcon 是 ForwardRefExoticComponent，
 * 属于「可调用的渲染函数」而非 FunctionComponent，用 ComponentType 会拒收全部 lucide 图标。
 */
export interface SegmentedRailItem<T extends string> {
    value: T
    /** 显示文字：省略时直接显示 value，标签类选项两者通常一致 */
    label?: string
    icon?: (props: { className?: string }) => ReactNode
    /**
     * 悬停说明：给出时该项带 tooltip，用于解释同组取值的差异。
     * 只用于非连体形态（chip / pill）：tooltip 需要包一层 span，会让 spacing=0 的圆角拼接失效。
     */
    hint?: string
}

/** pill 主色块高亮、outline 连体等分描边、chip 独立描边胶囊 */
export type SegmentedRailVariant = 'pill' | 'outline' | 'chip'

interface SegmentedRailBaseProps<T extends string> {
    items: readonly SegmentedRailItem<T>[]
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

/** 单选（默认）：value 与 onChange 都是单个枚举值 */
export interface SegmentedRailSingleProps<T extends string> extends SegmentedRailBaseProps<T> {
    isMultiple?: false
    value: T
    onChange: (value: T) => void
}

/** 多选：value 与 onChange 都是枚举值数组，顺序沿用点击顺序 */
export interface SegmentedRailMultipleProps<T extends string> extends SegmentedRailBaseProps<T> {
    isMultiple: true
    value: readonly T[]
    onChange: (value: T[]) => void
}

export type SegmentedRailProps<T extends string> = SegmentedRailSingleProps<T> | SegmentedRailMultipleProps<T>

const PILL_CONTAINER_CLASS = 'w-full flex-wrap rounded-lg bg-muted p-1'

const PILL_ITEM_CLASS =
    'h-8 gap-1 px-2 text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground'

/** chip 选中态：描边、底色、文字一起切到主色，避免只换底色时边框仍是 input 灰 */
const CHIP_ITEM_CLASS =
    'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground'

/**
 * 提示气泡固定暗底亮字：重写局部前景/背景变量即可，箭头是独立 svg（bg-foreground / fill-foreground），
 * 继承同一组变量后自动同色。与 Button 的 TOOLTIP_CLASS 同值，改色时两处一起改。
 */
const RAIL_TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'

interface RailClassNames {
    container: string | undefined
    item: string | undefined
}

/** 三种形态的容器与分段项类名在这里集中决定，调用方只选语义不拼样式 */
function resolveClassNames(variant: SegmentedRailVariant, isStretched: boolean, isWrapped: boolean): RailClassNames {
    if (variant === 'pill') {
        return { container: PILL_CONTAINER_CLASS, item: PILL_ITEM_CLASS }
    }
    if (variant === 'chip') {
        return { container: isWrapped ? 'flex-wrap' : undefined, item: CHIP_ITEM_CLASS }
    }
    return { container: isStretched ? 'w-full' : undefined, item: isStretched ? 'flex-1' : undefined }
}

export function SegmentedRail<T extends string>(props: SegmentedRailProps<T>): JSX.Element {
    const {
        items,
        ariaLabel,
        variant = 'pill',
        isStretched = true,
        isWrapped = true,
        size = 'default',
        isDisabled = false,
    } = props
    const classNames = resolveClassNames(variant, isStretched, isWrapped)
    const spacing = variant === 'pill' ? 1 : variant === 'chip' ? 2 : 0
    const groupVariant = variant === 'outline' ? 'outline' : undefined

    /** 回传值一律过一遍 items：单选取消选中会回传空串，多选也可能带上已删除的旧值 */
    const toValues = (next: readonly string[]): T[] =>
        next.filter((value): value is T => items.some((item) => item.value === value))

    const segments = items.map((item) => {
        const Icon = item.icon
        const text = item.label ?? item.value
        const segment = (
            <ToggleGroupItem
                key={item.value}
                value={item.value}
                variant={variant === 'chip' ? 'outline' : undefined}
                aria-label={text}
                className={classNames.item}
            >
                {Icon ? <Icon className="size-4" /> : null}
                {text}
            </ToggleGroupItem>
        )
        if (item.hint === undefined) {
            return segment
        }
        // 提示挂在包裹层上：data-state 落在 span，不会覆盖按钮自身的选中态
        return (
            <Tooltip key={item.value}>
                <TooltipTrigger asChild>
                    <span className="inline-flex">{segment}</span>
                </TooltipTrigger>
                <TooltipContent className={RAIL_TOOLTIP_CLASS}>{item.hint}</TooltipContent>
            </Tooltip>
        )
    })

    if (props.isMultiple) {
        return (
            <ToggleGroup
                type="multiple"
                spacing={spacing}
                variant={groupVariant}
                size={size}
                disabled={isDisabled}
                value={[...props.value]}
                onValueChange={(next) => {
                    props.onChange(toValues(next))
                }}
                aria-label={ariaLabel}
                className={classNames.container}
            >
                {segments}
            </ToggleGroup>
        )
    }

    return (
        <ToggleGroup
            type="single"
            spacing={spacing}
            variant={groupVariant}
            size={size}
            disabled={isDisabled}
            value={props.value}
            onValueChange={(next) => {
                const nextItem = items.find((item) => item.value === next)
                if (nextItem) {
                    props.onChange(nextItem.value)
                }
            }}
            aria-label={ariaLabel}
            className={classNames.container}
        >
            {segments}
        </ToggleGroup>
    )
}
