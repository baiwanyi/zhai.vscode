/**
 * 公众号展示层纯函数：状态文案、批次筛选排序、弹窗文案与关闭适配。
 * 复用约定：相对时间取 shared/utils/format，字数与粉丝数取 dashboard/utils 的 formatWordCount，
 * 账号类型文案取 shared/types/wechat 的 WECHAT_ACCOUNT_TYPE_LABELS，三处口径不在此重复定义；
 * 筛选档位的选项与收窄取本目录 constants，本文件只消费不重定义。
 * 关键约束：状态色点只用主题令牌（bg-primary / bg-destructive / bg-muted-foreground），不写死色值；
 * 元信息固定三段「批次数 · 粉丝 · 最近推送」，列表与账号页共用本文件，任一侧加字段都改这里；
 * 本文件不含 React 与宿主请求，所有函数可直接单测。
 */
import {
    WECHAT_ACCOUNT_TYPE_LABELS,
    type WechatAccountStatus,
    type WechatAccountSummary,
    type WechatArticleSourceKind,
    type WechatArticleSummary,
    type WechatIssueStatus,
    type WechatIssueSummary,
} from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import type { IssueFilter, IssueSort } from './constants'
import { formatWordCount } from '../utils'

/** 数据加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type WechatListStatus = 'loading' | 'ready' | 'error'

/** 状态短文案：用于徽标与提示，鉴权失败的具体原因由宿主的 statusHint 承载 */
export const WECHAT_STATUS_LABELS: Readonly<Record<WechatAccountStatus, string>> = {
    connected: '正常',
    unauthenticated: '未配置密钥',
    error: '鉴权失败',
    limited: '额度受限',
}

/** 状态色点：只用主题令牌，随明暗主题自动切换 */
export const WECHAT_STATUS_DOT_CLASS: Readonly<Record<WechatAccountStatus, string>> = {
    connected: 'bg-primary',
    unauthenticated: 'bg-muted-foreground opacity-50',
    error: 'bg-destructive',
    limited: 'bg-muted-foreground',
}

/** 账号类型徽标文案 */
export function formatAccountType(account: WechatAccountSummary): string {
    return WECHAT_ACCOUNT_TYPE_LABELS[account.accountType]
}

/**
 * 账号元信息行：批次数 · 粉丝数 · 最近推送。
 * 关键约束：鉴权失败时改由调用方展示 statusHint，本函数只负责正常态的三段口径。
 */
export function formatAccountMeta(account: WechatAccountSummary): string {
    const publishText =
        account.lastPublishAt === null ? '尚未推送' : `最近推送 ${formatRelativeTime(account.lastPublishAt)}`
    return [`${String(account.issueCount)} 篇`, `${formatWordCount(account.fanCount)} 粉丝`, publishText]
        .filter((part) => part.length > 0)
        .join(' · ')
}

/** 异常态摘要：优先用宿主落库的可执行提示，缺省时回落到状态文案 */
export function formatAccountStatusHint(account: WechatAccountSummary): string {
    if (account.status === 'connected') {
        return formatAccountMeta(account)
    }
    if (account.statusHint !== undefined && account.statusHint.length > 0) {
        return account.statusHint
    }
    return WECHAT_STATUS_LABELS[account.status]
}

/** 账号名首字：头像缺省时的占位字符，中英文都取第一个字符 */
export function readAccountInitial(name: string): string {
    const [first] = Array.from(name)
    return first ?? '公'
}

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

/** 文章正文来源文案 */
export const WECHAT_ARTICLE_SOURCE_LABELS: Readonly<Record<WechatArticleSourceKind, string>> = {
    manual: '手写',
    note: '笔记',
    press: '作品',
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

/** 文章行元信息：来源 + 字数，手写稿不重复标注来源 */
export function formatArticleMeta(article: WechatArticleSummary): string {
    const source = article.sourceKind === 'manual' ? '' : `来自${WECHAT_ARTICLE_SOURCE_LABELS[article.sourceKind]} · `
    return `${source}${String(article.wordCount)} 字`
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

/**
 * 文章设置弹窗的作者默认值：账号默认作者优先，其次列表里最近一篇填过作者的文章。
 * 关键约束：只作为弹窗初始值，不落库也不参与校验，用户改完即按文章各自保存。
 */
export function readDefaultArticleAuthor(account: WechatAccountSummary | null, issues: WechatIssueSummary[]): string {
    if (account !== null && account.defaultAuthor !== undefined && account.defaultAuthor.length > 0) {
        return account.defaultAuthor
    }
    for (const issue of issues) {
        for (const article of issue.articles) {
            if (article.author !== undefined && article.author.length > 0) {
                return article.author
            }
        }
    }
    return ''
}

/** 群发确认文案：账号、文章清单、额度说明与不可撤销提醒合成一段 */
export function buildPublishDescription(accountName: string, issue: WechatIssueSummary, quotaReason: string): string {
    const titles = issue.articles.map((item) => item.title).join('、')
    const quotaLine = quotaReason.length > 0 ? `${quotaReason}。` : ''
    return `账号「${accountName}」将群发 ${String(issue.articleCount)} 篇文章：${titles}。${quotaLine}群发后不可撤销，请确认封面与正文已检查。`
}

/** 弹窗 onOpenChange 适配：只在关闭时清空目标，避免打开瞬间把目标清掉 */
export function closeWhenHidden(close: () => void): (open: boolean) => void {
    return (open) => {
        if (!open) {
            close()
        }
    }
}
