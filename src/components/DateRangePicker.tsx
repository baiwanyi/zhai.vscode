/**
 * 日期区间选择器：Popover + Calendar 范围选择 + 清除按钮。
 * 禁用今天及之后（当天未结算）；min={1} 让首点只设起点，选满两端才提交。
 */
import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'
import { ButtonGroup } from '@components/ui/button-group'
import { Calendar } from '@components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import type { DateRange } from 'react-day-picker'

/** 把 YYYY-MM-DD 解析为本地日期；非法值返回 undefined */
function readDate(value: string | undefined): Date | undefined {
    if (value === undefined || value.length === 0) {
        return undefined
    }
    const [year, month, day] = value.split('-').map(Number)
    if (year === undefined || month === undefined || day === undefined) {
        return undefined
    }
    const date = new Date(year, month - 1, day)
    return Number.isNaN(date.getTime()) ? undefined : date
}

/** 把本地日期格式化为 YYYY-MM-DD，与宿主日期键口径一致 */
function formatDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${String(date.getFullYear())}-${month}-${day}`
}

interface DateRangePickerProps {
    beginDate: string
    endDate: string
    maxDate: string
    label: string
    onChange: (beginDate: string, endDate: string) => void
    onClear: () => void
}

export function DateRangePicker({
    beginDate,
    endDate,
    maxDate,
    label,
    onChange,
    onClear,
}: DateRangePickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [draft, setDraft] = useState<DateRange | undefined>(undefined)
    const lastSelectable = readDate(maxDate)
    const disabled = lastSelectable === undefined ? undefined : { after: lastSelectable }
    const hasCustomRange = beginDate.length > 0

    // 每次打开都以当前已生效区间为起点，避免上次未选完的中间态残留
    const onOpenChange = (next: boolean): void => {
        setIsOpen(next)
        if (next) {
            setDraft({ from: readDate(beginDate), to: readDate(endDate) })
        }
    }

    return (
        <Popover open={isOpen} onOpenChange={onOpenChange}>
            <ButtonGroup>
                <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" tooltip="选择区间">
                        <CalendarDays data-icon="inline-start" />
                        {label}
                    </Button>
                </PopoverTrigger>
                {hasCustomRange ? (
                    <Button size="icon-sm" variant="outline" aria-label="清除区间" tooltip="清除区间" onClick={onClear}>
                        <X data-icon="inline-start" />
                    </Button>
                ) : null}
            </ButtonGroup>
            <PopoverContent align="end" className="w-auto">
                <Calendar
                    mode="range"
                    min={1}
                    defaultMonth={readDate(beginDate)}
                    selected={draft}
                    disabled={disabled}
                    onSelect={(range) => {
                        // min={1} 下首点只返回 from、to 为空，保留 draft 显示起点高亮；
                        // 第二点返回排好序的完整区间，直接提交，不再自行推断点击日期。
                        setDraft(range)
                        if (range?.from === undefined || range.to === undefined) {
                            return
                        }
                        onChange(formatDate(range.from), formatDate(range.to))
                        setIsOpen(false)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}
