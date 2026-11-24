/**
 * 标注列表区块：提示条、错误条、空态与划线 / 批注条目，滚到底部自动续载。
 * 复用约定：条目取同目录 AnnotationListItem、容器取 ui/item 的 ItemGroup、空态文案取 ../emptyState、
 * 提示条取 ui/alert、错误条取 Alert、哨兵取 LoadMoreSentinel（观察器由 useScrollSentinel 提供）；
 * 数据与状态仍由页面的 hooks/useAnnotationList 持有，本组件只负责呈现与「继续加载」的触发。
 * 关键约束：续载哨兵统一走 @webview/hooks/useScrollSentinel（root 取页面 ScrollArea 视口、条目数变化重建）；
 * 空态与转圈必须跟随 isLoading——首屏未回来时不能先闪「还没有标注」；加载失败时只留错误条，
 * 不得再叠一条「还没有标注」的空态，否则与失败提示自相矛盾；
 * 有生效筛选时空态须说明是「被筛空」而非数据丢失。
 */
'use client'

import { Highlighter } from 'lucide-react'
import { memo } from 'react'
import { Alert as UiAlert, AlertDescription } from '@components/ui/alert'
import { ItemGroup } from '@components/ui/item'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { toErrorDetail } from '@shared/utils/error'
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Alert } from '@webview/components/Alert'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import { AnnotationListItem } from './AnnotationListItem'
import type { JSX } from 'react'
import { describeAnnotationListEmpty } from '../emptyState'

export interface AnnotationListSectionProps {
    items: AnnotationRecord[]
    /** 首屏或续载中：空态、骨架与哨兵转圈都据此切换 */
    isLoading: boolean
    /** 列表加载失败：与跳转提示分开，避免一条提示盖住另一条 */
    error: string | null
    /** 跳转结果提示：文档缺失与定位失效由页面判定后传入 */
    notice: string | null
    /** 当前是否有生效筛选：空态措辞据此区分「没有标注」与「被筛空」 */
    hasActiveFilter?: boolean
    hasMore: boolean
    onReveal: (id: string) => Promise<void>
    onUpdateColor: (id: string, color: HighlightColor) => Promise<void>
    onRemove: (id: string) => Promise<void>
    onLoadMore: () => Promise<void>
}

function AnnotationListSectionBase({
    items,
    isLoading,
    error,
    notice,
    hasActiveFilter = false,
    hasMore,
    onReveal,
    onUpdateColor,
    onRemove,
    onLoadMore,
}: AnnotationListSectionProps): JSX.Element {
    // 条目数作为观察信号：首屏未填满时靠它重建观察，才能链式补载
    const sentinelRef = useScrollSentinel({ hasMore, onLoadMore, observeKey: items.length })

    // 空态措辞（加载中 / 被筛空 / 确实没有）由纯函数统一给出，标题与描述成对
    const emptyCopy = describeAnnotationListEmpty({ isLoading, hasActiveFilter })

    return (
        <>
            {notice === null ? null : (
                <UiAlert>
                    <AlertDescription>{notice}</AlertDescription>
                </UiAlert>
            )}
            {error === null ? null : <Alert title="标注读取失败" description={toErrorDetail(error)} variant="destructive" />}
            {items.length === 0 && error === null ? (
                <StateEmpty
                    title={emptyCopy.title}
                    description={emptyCopy.description}
                    icon={Highlighter}
                    isLoading={isLoading}
                />
            ) : null}
            {items.length === 0 ? null : (
                <ItemGroup className="gap-2">
                    {items.map((item) => (
                        <AnnotationListItem
                            key={item.id}
                            item={item}
                            onReveal={onReveal}
                            onUpdateColor={onUpdateColor}
                            onRemove={onRemove}
                        />
                    ))}
                </ItemGroup>
            )}
            {hasMore ? <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={isLoading} /> : null}
        </>
    )
}

/**
 * 搜索结果每键都会刷新页面 state：条目与回调引用未变时不必重算整张列表。
 * 回调的稳定性由页面保证（useCallback），否则 memo 会整体失效。
 */
export const AnnotationListSection = memo(AnnotationListSectionBase)
