/**
 * 媒体页筛选区：年月 / 来源 / 关联状态三个下拉加清空入口，占标题行下方的整行。
 * 适用范围：只做这三个维度——图片类别（角色 / 设定 / 普通）不进筛选条，
 * 避免同一张图因归类不同而找不到；关联状态以「是否被正文或封面引用」为准。
 * 复用约定：外壳取 components/AppPage 的 AppMenu，年月下拉直接复用同目录 MonthSelect，
 * 来源与关联取 @components/ui/select，按钮取 @webview/components/Button。
 * 关键约束：受控组件，三个维度与清空动作都由页面持有，组件不保存筛选状态；
 * 选项由页面算好后传入，组件不重复推导文案与计数；来源与关联的取值在回调里显式收窄，不做类型断言。
 */
import { X } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@webview/components/Button'
import { MonthSelect } from './MonthSelect'
import type { MediaMonthOption } from '../hooks/mediaMonth'
import type { MediaLinkFilter, MediaOriginFilter } from '../hooks/useImageFilters'
import type { JSX } from 'react'

/** 触发器宽度固定，切换选项时整行筛选不会因文案长短而抖动 */
const TRIGGER_CLASS = 'w-32 shrink-0'

/** 来源选项：与 MediaOrigin 两值一一对应 */
const ORIGIN_OPTIONS: ReadonlyArray<{ value: MediaOriginFilter; label: string }> = [
    { value: 'all', label: '全部来源' },
    { value: 'upload', label: '上传' },
    { value: 'generate', label: '生图' },
]

/** 关联选项：已关联即 media_usage 里有行 */
const LINK_OPTIONS: ReadonlyArray<{ value: MediaLinkFilter; label: string }> = [
    { value: 'all', label: '全部关联' },
    { value: 'linked', label: '已关联' },
    { value: 'unlinked', label: '未关联' },
]

interface ImageGenFiltersProps {
    /** 当前年月：null 表示全部月份 */
    month: string | null
    /** 下拉选项：全部月份在首位，其余按年月倒序 */
    options: ReadonlyArray<MediaMonthOption>
    onMonthChange: (month: string | null) => void
    /** 当前来源：all 表示不筛 */
    origin: MediaOriginFilter
    onOriginChange: (origin: MediaOriginFilter) => void
    /** 当前关联状态：all 表示不筛 */
    link: MediaLinkFilter
    onLinkChange: (link: MediaLinkFilter) => void
    /** 是否有生效中的筛选：决定清空入口是否出现 */
    hasActiveFilter: boolean
    onClearFilters: () => void
}

export function ImageGenFilters({
    month,
    options,
    onMonthChange,
    origin,
    onOriginChange,
    link,
    onLinkChange,
    hasActiveFilter,
    onClearFilters,
}: ImageGenFiltersProps): JSX.Element {
    /** 来源收窄：认不出的值一律回到「全部」，不把脏值写进筛选状态 */
    const handleOriginChange = (value: string): void => {
        if (value === 'upload' || value === 'generate') {
            onOriginChange(value)
            return
        }
        onOriginChange('all')
    }

    /** 关联收窄：同上 */
    const handleLinkChange = (value: string): void => {
        if (value === 'linked' || value === 'unlinked') {
            onLinkChange(value)
            return
        }
        onLinkChange('all')
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <MonthSelect
                month={month}
                options={options}
                onChange={onMonthChange}
                triggerClassName={TRIGGER_CLASS}
                ariaLabel="按年月筛选"
            />
            <Select value={origin} onValueChange={handleOriginChange}>
                <SelectTrigger className={TRIGGER_CLASS} aria-label="按来源筛选">
                    <SelectValue placeholder="全部来源" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                    <SelectGroup>
                        {ORIGIN_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={link} onValueChange={handleLinkChange}>
                <SelectTrigger className={TRIGGER_CLASS} aria-label="按关联状态筛选">
                    <SelectValue placeholder="全部关联" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                    <SelectGroup>
                        {LINK_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
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
