/**
 * 笔记列表状态分派：按加载状态、失败与筛选结果选择骨架屏、错误提示或空态。
 * 复用 @components/ui 的 skeleton、alert、item 与空态组件；空态文案区分「尚无数据」与「筛选无结果」。
 * 关键约束：三态互斥，同一次渲染只呈现其中一种，占位样式统一走 Empty；
 * 骨架行复用 Item 的 sm 几何（px-3 py-1.5 + 圆角）并与列表同样零间距堆叠，
 * 骨架条高度对齐真实标题行高（text-sm leading-snug 即 20px），使加载完成时行高与间距都不跳变。
 */
import { FileText, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { Item, ItemActions, ItemContent, ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { StatsStatus } from '../hooks/useDashboardStats'
import type { JSX } from 'react'

/** 加载态骨架行数：贴近首屏可见条目数，避免加载完成后滚动高度突变 */
const SKELETON_ROW_KEYS = ['row-1', 'row-2', 'row-3']

interface NotesListStateProps {
    status: StatsStatus
    error: string | null
    isFiltered: boolean
    onResetFilters: () => void
}

export function NotesListState({ status, error, isFiltered, onResetFilters }: NotesListStateProps): JSX.Element {
    if (status === 'loading') {
        return (
            <ItemGroup className="has-data-[size=sm]:gap-0">
                {SKELETON_ROW_KEYS.map((rowKey) => (
                    <Item key={rowKey} size="sm" className="rounded-full py-1.5">
                        <ItemContent>
                            <Skeleton className="h-5 w-1/2" />
                        </ItemContent>
                        <ItemActions className="shrink-0">
                            <Skeleton className="h-3 w-12" />
                        </ItemActions>
                    </Item>
                ))}
            </ItemGroup>
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
                isFiltered ? '当前筛选或搜索条件下没有笔记，清除后查看全部。' : '点击上方「添加」创建第一篇笔记。'
            }
            icon={FileText}
            className="border px-3 py-4"
        >
            {isFiltered ? (
                <Button variant="outline" onClick={onResetFilters}>
                    清除条件
                </Button>
            ) : null}
        </StateEmpty>
    )
}
