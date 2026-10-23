/**
 * AI 使用量页：标题与汇总、筛选栏、用量表格与分页，点击请求 id 打开提示词弹窗。
 * 复用约定：列表经 useAiUsage 向宿主取（分页与汇总都在宿主侧完成），提示词经 useUsagePrompt 按需拉取；
 * 表格、筛选、分页与弹窗各自独立成组件，本文件只做状态编排与筛选/翻页的联动复位。
 * 关键约束：筛选变化必须把页码复位到 1，否则会停留在超出新结果集的页码上；
 * 弹窗关闭即清空当前请求，避免下次打开时闪现上一条提示词；刷新期间保留上一份表格避免闪空；
 * 刷新按钮带 force 强制重扫，页面停留时的 30 秒静默同步由 hook 负责。
 */
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Skeleton } from '@components/ui/skeleton'
import type { AiUsageItem, AiUsageModule, AiUsageRange } from '@shared/types/aiUsage'
import { DEFAULT_PAGE_SIZE, DEFAULT_RANGE } from './constants'
import { useAiUsage } from './hooks/useAiUsage'
import { useUsagePrompt } from './hooks/useUsagePrompt'
import { UsageFilterBar } from './layout/UsageFilterBar'
import { UsageHeader } from './layout/UsageHeader'
import { UsagePagination } from './layout/UsagePagination'
import { UsagePromptDialog } from './layout/UsagePromptDialog'
import { UsageTable } from './layout/UsageTable'
import type { JSX } from 'react'

export function AiUsagePage(): JSX.Element {
    const [module, setModule] = useState<AiUsageModule | null>(null)
    const [range, setRange] = useState<AiUsageRange>(DEFAULT_RANGE)
    const [page, setPage] = useState(1)
    const [activeItem, setActiveItem] = useState<AiUsageItem | null>(null)
    const { result, error, isLoading, refresh } = useAiUsage(module, range, page, DEFAULT_PAGE_SIZE)
    const { prompt, error: promptError } = useUsagePrompt(activeItem === null ? null : activeItem.requestId)

    const handleChangeModule = useCallback((next: AiUsageModule | null): void => {
        setModule(next)
        setPage(1)
    }, [])

    const handleChangeRange = useCallback((next: AiUsageRange): void => {
        setRange(next)
        setPage(1)
    }, [])

    const handleOpenRequest = useCallback((item: AiUsageItem): void => {
        setActiveItem(item)
    }, [])

    const handleClosePrompt = useCallback((): void => {
        setActiveItem(null)
    }, [])

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <UsageHeader
                summary={result?.summary ?? null}
                periods={result?.periods ?? null}
                isLoading={isLoading}
                onRefresh={refresh}
            />

            <UsageFilterBar
                module={module}
                range={range}
                onChangeModule={handleChangeModule}
                onChangeRange={handleChangeRange}
            />

            {error !== null && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-0.5">
                {isLoading && result === null ? (
                    <div className="flex flex-col gap-2 p-3">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                ) : (
                    <UsageTable items={result?.items ?? []} onOpenRequest={handleOpenRequest} />
                )}
            </div>

            <footer className="relative flex shrink-0 items-center justify-center gap-1.5 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent">
                <UsagePagination
                    page={result?.page ?? page}
                    pageSize={result?.pageSize ?? DEFAULT_PAGE_SIZE}
                    total={result?.total ?? 0}
                    onChangePage={setPage}
                />
            </footer>
            {activeItem !== null && (
                <UsagePromptDialog item={activeItem} prompt={prompt} error={promptError} onClose={handleClosePrompt} />
            )}
        </div>
    )
}
