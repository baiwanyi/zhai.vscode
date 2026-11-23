/**
 * 大纲筛选栏：模块切换、颗粒度视图、状态筛选、卷筛选与标题搜索，作为 AppMenu 的内容插槽使用。
 * 复用约定：下拉都取 ui/select（选项分别来自 constants 的 OUTLINE_MODULE_META、
 * GRANULARITY_OPTIONS、STATUS_FILTERS 与调用方派生的卷选项），搜索框取 ui/input-group。
 * 关键约束：模块与颗粒度只切视图，不改任何章节字段；状态 / 卷 / 搜索只收窄左侧章节列表，
 * 具体过滤由调用方完成，本组件不持有任何筛选状态；下拉回传字符串，按选项表收窄后再上抛。
 */
import { Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { AppMenu } from '@webview/components/AppPage'
import type { OutlineGranularity, OutlineModuleKey, PlanStatus } from '../../types'
import type { JSX } from 'react'
import {
    GRANULARITY_META,
    GRANULARITY_OPTIONS,
    GRANULARITY_ORDER,
    OUTLINE_MODULE_META,
    STATUS_FILTERS,
} from '../../constants'

interface OutlineFiltersProps {
    module: OutlineModuleKey
    granularity: OutlineGranularity
    statusFilter: PlanStatus | 'all'
    /** 卷筛选取值：'all' 为全部卷，否则为卷 id */
    volumeFilter: string
    /** 卷选项：由调用方按大纲树顺序去重，取值用卷 id */
    volumeOptions: readonly { value: string; label: string }[]
    /** 标题搜索关键词 */
    query: string
    onModuleChange: (module: OutlineModuleKey) => void
    onGranularityChange: (granularity: OutlineGranularity) => void
    onStatusChange: (status: PlanStatus | 'all') => void
    onVolumeChange: (value: string) => void
    onQueryChange: (value: string) => void
}

export function OutlineFilters({
    module,
    granularity,
    statusFilter,
    volumeFilter,
    volumeOptions,
    query,
    onModuleChange,
    onGranularityChange,
    onStatusChange,
    onVolumeChange,
    onQueryChange,
}: OutlineFiltersProps): JSX.Element {
    /** 下拉回传字符串：按选项表收窄，命中不到的自造值一律丢弃 */
    const handleStatusChange = (value: string): void => {
        const next = STATUS_FILTERS.find((option) => option.value === value)
        if (next) {
            onStatusChange(next.value)
        }
    }

    const handleModuleChange = (value: string): void => {
        const next = OUTLINE_MODULE_META.find((option) => option.value === value)
        if (next !== undefined) {
            onModuleChange(next.value)
        }
    }

    const handleGranularityChange = (value: string): void => {
        const next = GRANULARITY_ORDER.find((item) => item === value)
        if (next !== undefined) {
            onGranularityChange(next)
        }
    }

    return (
        <AppMenu>
            <Select value={module} onValueChange={handleModuleChange}>
                <SelectTrigger className="h-8 w-28" aria-label="大纲功能模块">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {OUTLINE_MODULE_META.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={granularity} onValueChange={handleGranularityChange}>
                <SelectTrigger className="h-8 w-24" aria-label="颗粒度视图">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {GRANULARITY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8 w-24" aria-label="状态筛选">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {STATUS_FILTERS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={volumeFilter} onValueChange={onVolumeChange}>
                <SelectTrigger className="h-8 w-28" aria-label="按卷筛选章节">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="all">全部卷</SelectItem>
                        {volumeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <InputGroup className="min-w-0 flex-1">
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    value={query}
                    aria-label="搜索章节标题"
                    placeholder="搜索章节标题"
                    onChange={(event) => onQueryChange(event.target.value)}
                />
            </InputGroup>
            <span className="shrink-0 text-muted-foreground" title={GRANULARITY_META[granularity].description}>
                视图：{GRANULARITY_META[granularity].label}
            </span>
        </AppMenu>
    )
}
