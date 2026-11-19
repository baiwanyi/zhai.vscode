/**
 * 大纲筛选栏：状态筛选、卷筛选与标题搜索三件控件，作为 AppMenu 的内容插槽使用。
 * 复用约定：两个下拉都取 ui/select（选项分别来自 constants 的 STATUS_FILTERS 与调用方派生的卷选项），
 * 搜索框取 ui/input-group（前置图标交给 InputGroupAddon），宽度由调用方容器决定。
 * 关键约束：下拉回传的是字符串，状态值在本组件内按选项表收窄回联合类型后再上抛；
 * 三个控件只收窄左侧章节列表，具体过滤由调用方完成，本组件不持有任何筛选状态。
 */
import { Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { AppMenu } from '@webview/components/AppPage'
import type { PlanStatus } from '../../types'
import type { JSX } from 'react'
import { STATUS_FILTERS } from '../../constants'

interface OutlineFiltersProps {
    statusFilter: PlanStatus | 'all'
    /** 卷筛选取值：'all' 为全部卷，否则为卷 id */
    volumeFilter: string
    /** 卷选项：由调用方按大纲树顺序去重，取值用卷 id */
    volumeOptions: readonly { value: string; label: string }[]
    /** 标题搜索关键词 */
    query: string
    onStatusChange: (status: PlanStatus | 'all') => void
    onVolumeChange: (value: string) => void
    onQueryChange: (value: string) => void
}

export function OutlineFilters({
    statusFilter,
    volumeFilter,
    volumeOptions,
    query,
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

    return (
        <AppMenu>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8 w-28" aria-label="状态筛选">
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
                <SelectTrigger className="h-8 w-32" aria-label="按卷筛选章节">
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
        </AppMenu>
    )
}
