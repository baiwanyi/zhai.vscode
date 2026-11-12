/**
 * 账号页页头：账号名与状态、返回入口，以及批次的状态筛选与排序下拉。
 * 复用约定：外壳槽位取 components/AppPage（AppHeader / AppTitle / AppDescription / AppMenu），
 * 下拉取 @components/ui/select，选项与收窄口径取 ../constants，展示文案取 ../utils。
 * 关键约束：本组件只负责展示与回传选定值，不持有筛选状态、不解析路由；
 * 收窄在回传前完成（readIssueFilter / readIssueSort），避免把任意字符串当成筛选条件。
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { AppDescription, AppHeader, AppMenu, AppTitle } from '@webview/components/AppPage'
import type { IssueFilter, IssueSort } from '../constants'
import type { JSX } from 'react'
import { DashboardBackAction } from '../../layout/DashboardBackAction'
import { FILTER_OPTIONS, readIssueFilter, readIssueSort, SORT_OPTIONS } from '../constants'

interface WechatPostHeaderProps {
    account: WechatAccountSummary
    /** 状态摘要：正常态给三段元信息，异常态给宿主的状态提示 */
    statusText: string
    filter: IssueFilter
    sort: IssueSort
    onFilterChange: (value: IssueFilter) => void
    onSortChange: (value: IssueSort) => void
}

export function WechatPostHeader({
    account,
    statusText,
    filter,
    sort,
    onFilterChange,
    onSortChange,
}: WechatPostHeaderProps): JSX.Element {
    return (
        <AppHeader align="start">
            <AppTitle tooltip={account.name}>{account.name}</AppTitle>
            <DashboardBackAction kind="home" />
            <DashboardBackAction kind="back" />
            <AppDescription>{statusText}</AppDescription>
            <AppMenu>
                <Select value={filter} onValueChange={(value) => onFilterChange(readIssueFilter(value))}>
                    <SelectTrigger size="sm" aria-label="状态筛选" className="min-w-28 flex-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {FILTER_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(value) => onSortChange(readIssueSort(value))}>
                    <SelectTrigger size="sm" aria-label="排序方式" className="min-w-28 flex-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SORT_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </AppMenu>
        </AppHeader>
    )
}
