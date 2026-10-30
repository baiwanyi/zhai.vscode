/**
 * 数据统计页：区间内的用户增长指标与逐日趋势。
 * 复用约定：数据取 hooks/useWechatStats，外壳取 AppPage，区间切换取 SegmentedRail；
 * 趋势图用纯 CSS 柱状（不引图表库，侧栏宽度也放不下坐标轴）。
 * 关键约束：datacube 需认证主体，失败时把宿主给的提示原样展示（多为「需要认证主体」），
 * 不显示空图表假装没数据；区间只开放 7 / 15 / 30，避免任意区间打满日额度；
 * 柱高按区间内最大值归一，全为 0 时统一给最小高度，避免出现「全空」的视觉误导。
 */
import { BarChart3 } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatAccountSummary, WechatStatsPoint } from '@shared/types/wechat'
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
import type { JSX } from 'react'
import { useWechatStats, type WechatStatsDays } from '../hooks/useWechatStats'

/** 区间档位 */
const RANGE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '7', label: '7 天' },
    { value: '15', label: '15 天' },
    { value: '30', label: '30 天' },
]

/** 收窄区间回传值 */
function readDays(value: string): WechatStatsDays {
    return value === '30' ? 30 : value === '15' ? 15 : 7
}

/** 柱状图：按最大值归一，最小高度保证 0 也可见 */
function TrendChart({ points }: { points: WechatStatsPoint[] }): JSX.Element {
    const max = points.reduce((peak, point) => Math.max(peak, point.newUsers), 0)
    return (
        <div className="flex w-full flex-col gap-1">
            <div className="flex h-24 items-end gap-0.5">
                {points.map((point) => {
                    const ratio = max === 0 ? 0 : point.newUsers / max
                    return (
                        <div
                            key={point.date}
                            className="flex-1 rounded-t-sm bg-primary/60"
                            style={{ height: `${String(Math.max(ratio * 100, point.newUsers > 0 ? 8 : 2))}%` }}
                            title={`${point.date}：新增 ${String(point.newUsers)}，取消 ${String(point.cancelUsers)}`}
                        />
                    )
                })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{points[0]?.date}</span>
                <span>{points[points.length - 1]?.date}</span>
            </div>
        </div>
    )
}

interface WechatStatsPageProps {
    account: WechatAccountSummary
}

export function WechatStatsPage({ account }: WechatStatsPageProps): JSX.Element {
    const { stats, days, status, error, setDays, reload } = useWechatStats(account.id)

    const renderBody = (): JSX.Element => {
        if (status === 'loading') {
            return (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                </div>
            )
        }
        if (status === 'error') {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <BarChart3 className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>数据读取失败</EmptyTitle>
                        <EmptyDescription>{error ?? '请稍后重试'}</EmptyDescription>
                        <EmptyDescription>
                            统计接口需要认证主体；未认证账号在公众号后台也看不到这部分数据。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        if (stats === null || stats.points.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>区间内没有数据</EmptyTitle>
                        <EmptyDescription>
                            平台按自然日结算，当天的数据要次日才有；刚关注的账号前两天可能全是 0。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="累计关注" value={stats.cumulateUsers} />
                    <MetricCard label="区间净增" value={stats.totalNet} />
                    <MetricCard label="新增关注" value={stats.totalNew} />
                    <MetricCard label="取消关注" value={stats.totalCancel} />
                </div>
                <div className="rounded-xl border p-3">
                    <p className="mb-2 text-xs text-muted-foreground">逐日新增</p>
                    <TrendChart points={stats.points} />
                </div>
            </div>
        )
    }

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>数据统计</AppTitle>
                <AppDescription>{`${account.name} · 用户增长`}</AppDescription>
                <AppMenu>
                    <SegmentedRail
                        items={RANGE_OPTIONS}
                        value={String(days)}
                        onChange={(value) => setDays(readDays(value))}
                        ariaLabel="统计区间"
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

/** 指标卡：数值为主，标签为辅 */
function MetricCard({ label, value }: { label: string; value: number }): JSX.Element {
    return (
        <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-heading text-xl">{String(value)}</p>
        </div>
    )
}
