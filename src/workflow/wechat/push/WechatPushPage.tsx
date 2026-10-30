/**
 * 推送管理页：把当前账号的批次按「待推送 / 历史 / 额度」三段呈现，是群发状态在运营侧的唯一视图。
 * 复用约定：数据取 hooks/useWechatPushOverview（批次 + 额度），状态徽标文案与变体取仪表盘同一套常量，
 * 外壳取 components/AppPage，分段切换取 SegmentedRail。
 * 关键约束：本页只读——生成草稿与群发仍在仪表盘批次页发起，避免同一动作在两处有入口而口径分叉；
 * 待推送包含草稿与推送中，历史包含已推送与失败，两段合起来覆盖全部状态，不会有批次凭空消失；
 * 额度单独失败时列表照常可用，额度区显示失败原因而不是把整页变成错误页。
 */
import { Send } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatAccountSummary, WechatIssueSummary } from '@shared/types/wechat'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import {
    formatIssueMeta,
    WECHAT_ISSUE_STATUS_LABELS,
    WECHAT_ISSUE_STATUS_VARIANTS,
} from '@webview/dashboard/wechat/utils'
import type { JSX } from 'react'
import { useWechatPushOverview } from '../hooks/useWechatPushOverview'

/** 三个分段：待推送与历史互斥，额度单独成段 */
type PushTab = 'queue' | 'history' | 'quota'

const TAB_OPTIONS: readonly { value: PushTab; label: string }[] = [
    { value: 'queue', label: '待推送' },
    { value: 'history', label: '历史' },
    { value: 'quota', label: '额度' },
]

/** 队列包含草稿、草稿就绪与推送中；历史包含已推送与失败 */
const QUEUE_STATUSES = new Set(['draft', 'ready', 'pushing', 'scheduled'])

/** 收窄分段值：非法值回落待推送 */
function readTab(value: string): PushTab {
    return value === 'history' ? 'history' : value === 'quota' ? 'quota' : 'queue'
}

interface WechatPushPageProps {
    /** 当前账号：由 WorkflowWechat 定位后下发，本页不再重复读取 */
    account: WechatAccountSummary
}

export function WechatPushPage({ account }: WechatPushPageProps): JSX.Element {
    const { issues, quota, status, error, quotaError, reload } = useWechatPushOverview(account.id)
    const [tab, setTab] = useState<PushTab>('queue')

    const queue = issues.filter((issue) => QUEUE_STATUSES.has(issue.status))
    const history = issues.filter((issue) => !QUEUE_STATUSES.has(issue.status))

    const renderBody = (): JSX.Element => {
        if (status === 'loading') {
            return <PushSkeleton />
        }
        if (status === 'error') {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>批次读取失败</EmptyTitle>
                        <EmptyDescription>{error ?? '请稍后重试'}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        if (tab === 'quota') {
            return <QuotaPanel quota={quota} quotaError={quotaError} />
        }
        const list = tab === 'queue' ? queue : history
        if (list.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <Send className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>{tab === 'queue' ? '没有待推送的批次' : '还没有推送记录'}</EmptyTitle>
                        <EmptyDescription>
                            {tab === 'queue'
                                ? '到仪表盘的批次页新建批次、编辑文章并生成草稿，就绪后会出现在这里。'
                                : '成功群发或失败重试过的批次会留在这里，便于回看时间与失败原因。'}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-2">
                {list.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} />
                ))}
            </div>
        )
    }

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>推送管理</AppTitle>
                <AppDescription>{`${account.name} · ${String(issues.length)} 个批次`}</AppDescription>
                <AppMenu>
                    <SegmentedRail
                        items={TAB_OPTIONS}
                        value={tab}
                        onChange={(value) => setTab(readTab(value))}
                        ariaLabel="推送管理分段"
                        variant="outline"
                        size="sm"
                    />
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>{renderBody()}</AppContent>
            <AppFooter>
                <Button variant="outline" onClick={() => void reload()}>
                    刷新
                </Button>
            </AppFooter>
        </AppPage>
    )
}

/** 批次行：标题、状态徽标与元信息；失败时把原因放在副行，不再额外弹提示 */
function IssueRow({ issue }: { issue: WechatIssueSummary }): JSX.Element {
    const isFailed = issue.status === 'failed'
    return (
        <Item variant="outline" className="flex-nowrap">
            <ItemContent className="min-w-0">
                <ItemTitle className="w-full">
                    <span className="block min-w-0 flex-1 truncate">{issue.title}</span>
                </ItemTitle>
                <ItemDescription className={isFailed ? 'line-clamp-2 text-xs' : 'truncate text-xs'}>
                    {isFailed && issue.errorHint !== undefined ? issue.errorHint : formatIssueMeta(issue)}
                </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0">
                <Badge variant={WECHAT_ISSUE_STATUS_VARIANTS[issue.status]}>
                    {WECHAT_ISSUE_STATUS_LABELS[issue.status]}
                </Badge>
            </ItemActions>
        </Item>
    )
}

/** 额度面板：剩余次数为主信息，周期规则与恢复时间由宿主给出 */
function QuotaPanel({
    quota,
    quotaError,
}: {
    quota: ReturnType<typeof useWechatPushOverview>['quota']
    quotaError: string | null
}): JSX.Element {
    if (quota === null) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>额度读取失败</EmptyTitle>
                    <EmptyDescription>{quotaError ?? '请稍后重试'}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }
    return (
        <div className="flex w-full flex-col gap-2 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">剩余可群发次数</p>
            <p className="font-heading text-2xl">
                {String(quota.remaining)}
                <span className="ml-1 text-sm text-muted-foreground">{`/ ${String(quota.limit)} 次`}</span>
            </p>
            <p className="text-xs text-muted-foreground">{quota.reason}</p>
            <p className="text-xs text-muted-foreground">{`本周期已用 ${String(quota.used)} 次`}</p>
        </div>
    )
}

/** 加载骨架：与批次行同高，等待期间不跳动 */
function PushSkeleton(): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
        </div>
    )
}
