/**
 * 公众号批次展示口径：状态文案与徽标变体、元信息、列表筛选排序。
 * 复用约定：相对时间取 shared/utils/format，筛选档位取 constants 的选项与收窄函数；
 * 状态文案与徽标变体的键与 shared/types/wechat 的批次状态同源。
 * 关键约束：筛选排序先复制再排序，不改动宿主快照顺序；时间缺失时只展示篇数，不补占位文案。
 */
import type { WechatIssueStatus, WechatIssueSummary } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import type { IssueFilter, IssueSort } from '../constants'

/** 数据加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type WechatListStatus = 'loading' | 'ready' | 'error'

/** 批次状态文案 */
export const WECHAT_ISSUE_STATUS_LABELS: Readonly<Record<WechatIssueStatus, string>> = {
    draft: '草稿',
    ready: '草稿已就绪',
    scheduled: '定时中',
    pushing: '推送中',
    published: '已推送',
    failed: '推送失败',
}

/** 批次徽标变体：与 shadcn badge 的变体名同源，避免各页面自选颜色 */
export const WECHAT_ISSUE_STATUS_VARIANTS: Readonly<
    Record<WechatIssueStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
    draft: 'outline',
    ready: 'secondary',
    scheduled: 'secondary',
    pushing: 'default',
    published: 'default',
    failed: 'destructive',
}

/**
 * 批次元信息：篇数 + 时间。已推送看推送时间，定时看计划时间，其余看更新时间。
 * 关键约束：时间缺失时只展示篇数，不补「未知」占位，避免列表里出现无信息量的文案。
 */
export function formatIssueMeta(issue: WechatIssueSummary): string {
    const parts = [`${String(issue.articleCount)} 篇`]
    if (issue.publishedAt !== undefined && issue.publishedAt.length > 0) {
        parts.push(`推送于 ${formatRelativeTime(issue.publishedAt)}`)
    } else if (issue.scheduledAt !== undefined && issue.scheduledAt.length > 0) {
        parts.push(`定时 ${formatRelativeTime(issue.scheduledAt)}`)
    } else {
        parts.push(`更新于 ${formatRelativeTime(issue.updatedAt)}`)
    }
    return parts.join(' · ')
}

/**
 * 按状态筛选并按选定字段倒序：推送时间档把未推送的排末尾，同档回落到更新时间。
 * 关键约束：先复制再排序，不改动宿主快照数组的顺序（列表与封面请求共用同一份快照）。
 */
export function filterAndSortIssues(
    issues: WechatIssueSummary[],
    filter: IssueFilter,
    sort: IssueSort,
): WechatIssueSummary[] {
    const filtered = filter === 'all' ? issues : issues.filter((issue) => issue.status === filter)
    return [...filtered].sort((left, right) => {
        if (sort === 'published') {
            const leftTime = left.publishedAt ?? ''
            const rightTime = right.publishedAt ?? ''
            if (leftTime !== rightTime) {
                return rightTime.localeCompare(leftTime)
            }
        }
        return right.updatedAt.localeCompare(left.updatedAt)
    })
}
