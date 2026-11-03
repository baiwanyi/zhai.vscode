/**
 * 月份下拉：全部月份 + 各年月张数，受控组件，值在 'all' 与 null 之间折算。
 * 复用约定：选项由页面用 toMonthOptions 算好后传入（label 已含年月格式化），组件不重复推导文案；
 * 结构沿用媒体页筛选栏口径（popper 定位 + 限高滚动），计数用弱化灰字区分主文案。
 * 关键约束：Radix Select 不接受空字符串作为选项值，故「全部月份」用 'all' 占位，
 * 回调前统一折算成 null，调用方拿到的始终是 null 或 'YYYY-MM'。
 */
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { MediaMonthOption } from '../hooks/useImageFilters'
import type { JSX } from 'react'

/** 全部月份的占位值：Radix Select 不接受空字符串作为选项值 */
const ALL_MONTHS = 'all'

interface MonthSelectProps {
    /** 当前年月：null 表示全部月份 */
    month: string | null
    /** 下拉选项：全部月份在首位，其余按年月倒序 */
    options: readonly MediaMonthOption[]
    onChange: (month: string | null) => void
    /** 触发器尺寸类：默认与图库页页头一致 */
    triggerClassName?: string
    ariaLabel?: string
}

export function MonthSelect({
    month,
    options,
    onChange,
    triggerClassName = 'h-8 w-32',
    ariaLabel = '按月筛选',
}: MonthSelectProps): JSX.Element {
    return (
        <Select value={month ?? ALL_MONTHS} onValueChange={(value) => onChange(value === ALL_MONTHS ? null : value)}>
            <SelectTrigger className={triggerClassName} aria-label={ariaLabel}>
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
    )
}
