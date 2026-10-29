/**
 * 媒体页筛选区：年月下拉加清空入口，占标题行下方的整行。
 * 适用范围：只做时间维度筛选——图片类型不进筛选条，角色维度也不再收窄，避免同一张图因归类不同而找不到。
 * 复用约定：外壳取 components/AppPage 的 AppMenu，下拉取 @components/ui/select（选项带该月张数），
 * 按钮取 @webview/components/Button（图标按钮的可访问名由 aria-label 承担）。
 * 关键约束：受控组件，month 与清空动作都由页面持有，组件不保存筛选状态；
 * 选项由页面算好后传入，组件不重复推导文案与计数；「全部月份」用 'all' 占位，回调前折算成 null。
 */
import { X } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@webview/components/Button'
import type { MediaMonthOption } from '../hooks/useImageFilters'
import type { JSX } from 'react'

/** 全部月份的占位值：Radix Select 不接受空字符串作为选项值 */
const ALL_MONTHS = 'all'

/** 触发器宽度固定，切换选项时整行筛选不会因文案长短而抖动 */
const TRIGGER_CLASS = 'w-36 shrink-0'

interface ImageGenFiltersProps {
    /** 当前年月：null 表示全部月份 */
    month: string | null
    /** 下拉选项：全部月份在首位，其余按年月倒序 */
    options: ReadonlyArray<MediaMonthOption>
    onMonthChange: (month: string | null) => void
    /** 是否有生效中的筛选：决定清空入口是否出现 */
    hasActiveFilter: boolean
    onClearFilters: () => void
}

export function ImageGenFilters({
    month,
    options,
    onMonthChange,
    hasActiveFilter,
    onClearFilters,
}: ImageGenFiltersProps): JSX.Element {
    /** 下拉回调只给字符串：'all' 折算回 null，其余原样上报 */
    const handleChange = (value: string): void => {
        onMonthChange(value === ALL_MONTHS ? null : value)
    }

    return (
        <div className="flex items-center gap-2">
            <Select value={month ?? ALL_MONTHS} onValueChange={handleChange}>
                <SelectTrigger className={TRIGGER_CLASS} aria-label="按年月筛选">
                    <SelectValue placeholder="全部月份" />
                </SelectTrigger>
                {/* 月份数量随使用时长增长：限高 16rem 并在列表内滚动。必须配 popper——默认 item-aligned 的定位写在父级 wrapper 的内联样式上，子元素覆盖不到，限高会把内容压到页面底部 */}
                <SelectContent position="popper" sideOffset={4} className="max-h-64">
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                                <span className="text-muted-foreground ml-1 text-xs tabular-nums">{option.count}</span>
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            {hasActiveFilter && (
                <Button size="icon" tooltip="清空筛选" aria-label="清空筛选" onClick={onClearFilters}>
                    <X />
                </Button>
            )}
        </div>
    )
}

export type { ImageGenFiltersProps }
