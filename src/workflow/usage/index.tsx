/**
 * AI 使用量页：以 AppPage 骨架承载「标题区（汇总 + 筛选、周期概览与积分余额入口、刷新）、用量表格、分页」，
 * 点击请求 id 打开提示词弹窗。
 * 复用约定：外壳取 components/AppPage（刷新按钮进标题行 AppAction、汇总走 AppDescription、
 * 今日 / 本月积分以 Badge 与筛选同排在 AppMenu、表格走 AppContent 滚动、分页进 AppFooter）；
 * 列表经 useAiUsage 向宿主取（分页与汇总都在宿主侧完成），提示词经 useUsagePrompt 按需拉取；
 * 表格、筛选、分页与弹窗各自独立成组件，本文件只做状态编排与筛选/翻页的联动复位。
 * 关键约束：筛选变化必须把页码复位到 1，否则会停留在超出新结果集的页码上；
 * 弹窗关闭即清空当前请求，避免下次打开时闪现上一条提示词；刷新期间保留上一份表格避免闪空；
 * 刷新按钮带 force 强制重扫，页面停留时的 30 秒静默同步由 hook 负责；
 * 积分余额入口只按站点跳转网页，余额构成由 CodeBuddy 网页端展示，本地与 CLI 都没有余额数据。
 */
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Badge } from '@components/ui/badge'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { AiUsageItem, AiUsageModule, AiUsagePeriods, AiUsageRange } from '@shared/types/aiUsage'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { DEFAULT_PAGE_SIZE, DEFAULT_RANGE } from './constants'
import { useAiUsage } from './hooks/useAiUsage'
import { useUsagePrompt } from './hooks/useUsagePrompt'
import { UsageFilterBar } from './layout/UsageFilterBar'
import { UsagePagination } from './layout/UsagePagination'
import { UsagePromptDialog } from './layout/UsagePromptDialog'
import { UsageTable } from './layout/UsageTable'
import { formatCredits, formatTokens } from './utils'
import type { JSX } from 'react'

/** 空列表常量：表格在首轮失败时也要拿到稳定引用，避免每次渲染新建数组 */
const EMPTY_ITEMS: AiUsageItem[] = []

export function AiUsagePage(): JSX.Element {
    const [module, setModule] = useState<AiUsageModule | null>(null)
    const [range, setRange] = useState<AiUsageRange>(DEFAULT_RANGE)
    const [page, setPage] = useState(1)
    const [activeItem, setActiveItem] = useState<AiUsageItem | null>(null)
    const { result, error, isLoading, refresh } = useAiUsage(module, range, page, DEFAULT_PAGE_SIZE)
    // 弹窗关闭时 activeItem 为 null，请求 id 直接由可选链得出，无需求值再判空
    const { prompt, error: promptError } = useUsagePrompt(activeItem?.requestId ?? null)

    /** 筛选一并复位页码：沿用旧页码会落在新结果集之外 */
    const handleChangeModule = (next: AiUsageModule | null): void => {
        setModule(next)
        setPage(1)
    }

    const handleChangeRange = (next: AiUsageRange): void => {
        setRange(next)
        setPage(1)
    }

    const handleOpenRequest = (item: AiUsageItem): void => {
        setActiveItem(item)
    }

    const handleClosePrompt = (): void => {
        setActiveItem(null)
    }

    // 首次加载尚无任何结果才出骨架；后续刷新保留上一份表格，避免闪空
    const isFirstLoading = isLoading && result === null
    // 分页优先跟随宿主回传（与表格数据同源），首轮尚未返回时用本地请求参数兜底
    const pageView = result ?? { page, pageSize: DEFAULT_PAGE_SIZE, total: 0 }

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>AI 使用量</AppTitle>
                    <AppAction>
                        <Button
                            size="icon"
                            variant="outline"
                            aria-label="刷新用量"
                            tooltip="刷新用量"
                            disabled={isLoading}
                            onClick={refresh}
                        >
                            {isLoading ? (
                                <Spinner className="size-4" aria-label="正在刷新用量" />
                            ) : (
                                <RefreshCw className="size-4" />
                            )}
                        </Button>
                    </AppAction>
                    {result !== null && (
                        <AppDescription>
                            共 {result.summary.requests} 次请求 · 合计 {formatCredits(result.summary.credits)} 积分 ·{' '}
                            {formatTokens(result.summary.tokens)} tokens
                        </AppDescription>
                    )}
                    <AppMenu className="justify-between">
                        <UsageFilterBar
                            module={module}
                            range={range}
                            onChangeModule={handleChangeModule}
                            onChangeRange={handleChangeRange}
                        />
                        {result !== null && (
                            <div className="flex items-center gap-1.5">
                                <UsagePeriodBadges periods={result.periods} />
                                <OpenCreditsButton />
                            </div>
                        )}
                    </AppMenu>
                    {error !== null && (
                        <Alert variant="destructive" className="w-full">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </AppHeader>

                <AppContent isScrollable>
                    {isFirstLoading ? (
                        <div className="flex flex-col gap-2 p-3">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                        </div>
                    ) : (
                        <UsageTable items={result?.items ?? EMPTY_ITEMS} onOpenRequest={handleOpenRequest} />
                    )}
                </AppContent>

                <AppFooter className="justify-center">
                    <UsagePagination
                        page={pageView.page}
                        pageSize={pageView.pageSize}
                        total={pageView.total}
                        onChangePage={setPage}
                    />
                </AppFooter>
            </AppPage>
            {activeItem !== null && (
                <UsagePromptDialog item={activeItem} prompt={prompt} error={promptError} onClose={handleClosePrompt} />
            )}
        </>
    )
}

interface UsagePeriodBadgesProps {
    periods: AiUsagePeriods
}

/** 固定区间积分：今日与本月只跟随模块筛选，与列表的时间范围无关 */
function UsagePeriodBadges({ periods }: UsagePeriodBadgesProps): JSX.Element {
    return (
        <div className="flex gap-1.5">
            <Badge variant="outline">今日积分 {formatCredits(periods.today)}</Badge>
            <Badge variant="outline">本月积分 {formatCredits(periods.month)}</Badge>
        </div>
    )
}

/**
 * 积分余额入口：余额构成（套餐赠送、平台奖励）只在 CodeBuddy 网页端可见，本地与 CLI 都没有余额数据，
 * 因此这里只按当前站点跳转。关键约束：前端不持有地址，只传固定标识，URL 由宿主解析后 openExternal。
 */
function OpenCreditsButton(): JSX.Element {
    const handleClick = useCallback((): void => {
        void request('host/openExternal', 'credits').catch(toastError)
    }, [])

    return (
        <Button size="xs" variant="outline" tooltip="在浏览器中查看积分余额" onClick={handleClick}>
            <ExternalLink className="size-3" />
            积分余额
        </Button>
    )
}
