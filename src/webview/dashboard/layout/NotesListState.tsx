/**
 * 笔记列表状态分派：按加载状态、失败与筛选结果选择骨架屏、错误提示或空态。
 * 复用 @components/ui 的 skeleton、alert 与 empty；空态文案区分「尚无数据」与「筛选无结果」。
 * 关键约束：三态互斥，同一次渲染只呈现其中一种，占位样式统一走 Empty。
 */
import { FileText, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { Skeleton } from '@components/ui/skeleton'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { StatsStatus } from '../hooks/useDashboardStats'
import type { JSX } from 'react'

interface NotesListStateProps {
    status: StatsStatus
    error: string | null
    isFiltered: boolean
    onResetFilters: () => void
}

export function NotesListState({ status, error, isFiltered, onResetFilters }: NotesListStateProps): JSX.Element {
    if (status === 'loading') {
        return (
            <div className="flex flex-col gap-2">
                <Skeleton className="h-11 w-full rounded-full" />
                <Skeleton className="h-11 w-full rounded-full" />
                <Skeleton className="h-11 w-full rounded-full" />
            </div>
        )
    }

    if (status === 'error') {
        return (
            <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>统计读取失败</AlertTitle>
                <AlertDescription>{error ?? '宿主未返回错误详情'}</AlertDescription>
            </Alert>
        )
    }

    return (
        <StateEmpty
            title={isFiltered ? '筛选无结果' : '暂无笔记'}
            description={
                isFiltered ? '当前筛选条件下没有笔记，可清除筛选后查看全部。' : '点击上方「添加」创建第一篇笔记。'
            }
            icon={FileText}
            className="border px-3 py-4"
        >
            {isFiltered ? (
                <Button variant="outline" onClick={onResetFilters}>
                    清除筛选
                </Button>
            ) : null}
        </StateEmpty>
    )
}
