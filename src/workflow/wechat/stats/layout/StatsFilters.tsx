/**
 * 统计页筛选区：视图、区间档位与自定义日期。
 * 校验失败弹 toast 且不改区间；清除回到预设 7 天。自定义日期用 DateRangePicker。
 */
import { useMemo } from 'react'
import { toast } from 'sonner'
import type { WechatStatsRange, WechatStatsView, WechatStatsViewMeta } from '@shared/types/wechat'
import { readYesterdayKey } from '@shared/utils/date'
import { DateRangePicker } from '@webview/components/DateRangePicker'
import { OptionSelect } from '@webview/components/OptionSelect'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { StatsViewOption } from '../utils/statsViewOptions'
import type { JSX } from 'react'
import { readCustomRangeError } from '../utils/statsRange'

/** 预设区间档位 */
const RANGE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '7', label: '7天' },
    { value: '15', label: '15天' },
    { value: '30', label: '30天' },
]

/** 收窄区间回传值 */
function readDays(value: string): 7 | 15 | 30 {
    return value === '30' ? 30 : value === '15' ? 15 : 7
}

/** 检测统计区间是否已加入预设筛选：命中返回档位值，custom 与非法 days 均返回空串 */
function readActiveRangeValue(range: WechatStatsRange): string {
    if (range.kind !== 'days') {
        return ''
    }
    const value = String(range.days)
    return RANGE_OPTIONS.some((option) => option.value === value) ? value : ''
}

interface StatsFiltersProps {
    view: WechatStatsView
    viewOptions: readonly StatsViewOption[]
    meta: WechatStatsViewMeta
    range: WechatStatsRange
    onViewChange: (view: WechatStatsView) => void
    onRangeChange: (range: WechatStatsRange) => void
}

export function StatsFilters({
    view,
    viewOptions,
    meta,
    range,
    onViewChange,
    onRangeChange,
}: StatsFiltersProps): JSX.Element {
    const yesterday = useMemo(() => readYesterdayKey(), [])

    const onPresetChange = (value: string): void => {
        onRangeChange({ kind: 'days', days: readDays(value) })
    }

    const onCustomChange = (beginDate: string, endDate: string): void => {
        const error = readCustomRangeError(beginDate, endDate, meta, yesterday)
        if (error !== null) {
            toast.error(error)
            return
        }
        onRangeChange({ kind: 'custom', beginDate, endDate })
    }

    const onClear = (): void => {
        onRangeChange({ kind: 'days', days: 7 })
    }

    return (
        <div className="flex items-center gap-2 mb-3">
            <OptionSelect value={view} options={viewOptions} onChange={onViewChange} label="统计视图" size="sm" />
            <SegmentedRail
                items={RANGE_OPTIONS}
                value={readActiveRangeValue(range)}
                onChange={onPresetChange}
                label="统计区间"
                variant="outline"
                size="sm"
            />
            <DateRangePicker
                beginDate={range.kind === 'custom' ? range.beginDate : ''}
                endDate={range.kind === 'custom' ? range.endDate : ''}
                maxDate={yesterday}
                label={range.kind === 'custom' ? `${range.beginDate} 至 ${range.endDate}` : '自定义'}
                onChange={onCustomChange}
                onClear={onClear}
            />
        </div>
    )
}
