/**
 * 批次列表的筛选、排序与分页渲染：把「筛状态 → 排序 → 截断渲染 → 取封面」串成一条数据链。
 * 复用约定：筛选档位取 ../constants，排序实现取 ../utils 的 filterAndSortIssues，
 * 封面地址由 useWechatIssueCovers 按渲染结果请求，只为可见批次取图。
 * 关键约束：切换筛选/排序刻意不重置渲染上限——沿用当前上限只是多渲染几个卡片，
 * 而在 effect 里同步 setState 会多一轮渲染，代价更明显；
 * 列表与封面共用同一份切片结果，口径不得两处各切一次。
 */
import { useMemo, useState } from 'react'
import type { WechatIssueSummary } from '@shared/types/wechat'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import { useWechatIssueCovers } from './useWechatIssueCovers'
import type { IssueFilter, IssueSort } from '../constants'
import { filterAndSortIssues } from '../utils'

/** 分批渲染步长：批次多时先渲染 20 个，点「加载更多」再追加，避免一次挂载全部卡片 */
const ISSUE_RENDER_STEP = 20

export interface WechatIssueQueryState {
    filter: IssueFilter
    sort: IssueSort
    setFilter: (value: IssueFilter) => void
    setSort: (value: IssueSort) => void
    /** 筛选排序后的全量结果：页脚计数与「加载更多」依赖它 */
    visibleIssues: WechatIssueSummary[]
    /** 实际渲染的批次：列表与封面请求都只认这一份切片 */
    renderIssues: WechatIssueSummary[]
    /** 封面路径 → Webview 地址，缺失项由卡片回落占位图 */
    covers: Record<string, string>
    hasMore: boolean
    /** 仍未渲染的批次数 */
    remaining: number
    loadMore: () => void
}

export function useWechatIssueQuery(issues: WechatIssueSummary[]): WechatIssueQueryState {
    const [filter, setFilter] = useState<IssueFilter>('all')
    const [sort, setSort] = useState<IssueSort>('updated')

    const visibleIssues = useMemo(() => filterAndSortIssues(issues, filter, sort), [filter, issues, sort])
    const { limit, hasMore, remaining, loadMore } = useRenderLimit(visibleIssues.length, ISSUE_RENDER_STEP)
    const renderIssues = useMemo(() => visibleIssues.slice(0, limit), [limit, visibleIssues])
    const covers = useWechatIssueCovers(renderIssues)

    return {
        filter,
        sort,
        setFilter,
        setSort,
        visibleIssues,
        renderIssues,
        covers,
        hasMore,
        remaining,
        loadMore,
    }
}
