/**
 * 推送批次列表区块：按加载状态分派，加载中给骨架、失败给重试、无数据给引导、有数据给批次卡片。
 * 复用 @components/ui 的 skeleton、业务公共层的 StateEmpty 与 wechat 的 WechatIssueCard。
 * 关键约束：筛选与排序由页面持有（结果经 props 传入），本组件不再二次过滤，避免两处口径；
 * 空态区分「列表为空」与「筛选后为空」：前者引导建批次，后者只提供清除筛选的入口；
 * 骨架条数与卡片同高，等待期间列表不塌陷。
 */
import { Send } from 'lucide-react'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { WechatIssueCard } from './WechatIssueCard'
import type { WechatListStatus } from '../utils'
import type { JSX } from 'react'

/** 骨架占位 key：固定两条，够覆盖首屏 */
const SKELETON_KEYS = ['i0', 'i1'] as const

interface WechatIssueListProps {
    issues: WechatIssueSummary[]
    status: WechatListStatus
    error: string | null
    isBusy: boolean
    /** 批次首图在 Webview 里的地址：键为文章里的封面路径 */
    covers: Record<string, string>
    /** 已勾选的批次 id：只有草稿与失败批次可勾选 */
    selectedIds: string[]
    onToggleSelect: (issue: WechatIssueSummary) => void
    /** 是否处于筛选态：筛选后为空时给出「清除筛选」而不是「新建批次」 */
    isFiltered: boolean
    onClearFilter: () => void
    onAdd: () => void
    onRetry: () => void
    onAddArticle: (issue: WechatIssueSummary) => void
    onImport: (issue: WechatIssueSummary, sourceKind: 'note' | 'press') => void
    onEditArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
    onRemoveIssue: (issue: WechatIssueSummary) => void
    onPublishDraft: (issue: WechatIssueSummary) => void
    onPublish: (issue: WechatIssueSummary) => void
    onOpenBackend: () => void
}

export function WechatIssueList({
    issues,
    status,
    error,
    isBusy,
    covers,
    selectedIds,
    onToggleSelect,
    isFiltered,
    onClearFilter,
    onAdd,
    onRetry,
    onAddArticle,
    onImport,
    onEditArticle,
    onRemoveArticle,
    onRemoveIssue,
    onPublishDraft,
    onPublish,
    onOpenBackend,
}: WechatIssueListProps): JSX.Element {
    if (status === 'loading') {
        return <IssueSkeleton />
    }

    if (status === 'error') {
        return (
            <StateEmpty title="批次列表加载失败" description={error ?? '请稍后重试'}>
                <Button variant="outline" onClick={onRetry}>
                    重试
                </Button>
            </StateEmpty>
        )
    }

    if (issues.length === 0) {
        if (isFiltered) {
            return (
                <StateEmpty title="没有符合筛选的批次" description="换个状态看看，或清除筛选回到全部批次。">
                    <Button variant="outline" onClick={onClearFilter}>
                        清除筛选
                    </Button>
                </StateEmpty>
            )
        }
        return (
            <StateEmpty
                title="还没有推送批次"
                description="一次群发对应一个批次，批次内可放 1~8 篇文章。先建一个批次，再从笔记或作品导入文章。"
                icon={Send}
                iconClassName="size-12 rounded-2xl"
            >
                <Button disabled={isBusy} onClick={onAdd}>
                    新建批次
                </Button>
            </StateEmpty>
        )
    }

    return (
        <div className="flex w-full flex-col gap-2">
            {issues.map((issue) => (
                <WechatIssueCard
                    key={issue.id}
                    issue={issue}
                    coverUri={covers[issue.articles[0]?.coverPath ?? '']}
                    isSelectable={issue.status === 'draft' || issue.status === 'failed'}
                    isSelected={selectedIds.includes(issue.id)}
                    onToggleSelect={onToggleSelect}
                    isBusy={isBusy}
                    onAddArticle={onAddArticle}
                    onImport={onImport}
                    onEditArticle={onEditArticle}
                    onRemoveArticle={onRemoveArticle}
                    onRemoveIssue={onRemoveIssue}
                    onPublishDraft={onPublishDraft}
                    onPublish={onPublish}
                    onOpenBackend={onOpenBackend}
                />
            ))}
        </div>
    )
}

/** 加载骨架：与批次卡片同高 */
function IssueSkeleton(): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            {SKELETON_KEYS.map((key) => (
                <Skeleton key={key} className="h-32 w-full rounded-xl" />
            ))}
        </div>
    )
}
