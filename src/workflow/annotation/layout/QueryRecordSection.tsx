/**
 * AI 解释区块：标注页里的解释记录（按文本聚合），滚到底部自动续载。
 * 复用约定：条目取同目录 QueryRecordItem、空态文案取 ../emptyState、容器取 ui/item 的 ItemGroup、
 * 错误条取 ListErrorAlert、哨兵取 LoadMoreSentinel，观察器由 useScrollSentinel 提供。
 * 关键约束：搜索复用页面顶部那一个输入框（keyword 由外部传入），本区块不自建搜索栏、不套卡片外壳；
 * 数据自取而非受控：分页与删除编排在 hooks/useQueryRecords，本区块与页签开关、页头统计无联动，
 * 提到页面只会多一层 keyword 与 onRemove 的透传；加载失败时只留错误条，不再叠「还没有记录」的空态；
 * 只关心「文本 + 结果」，不展示来源文档、也不提供跳转，因此没有跳转失败的提示分支；
 * 删除成功后经 onRecordsChange 上报：页头的「查询 N」不归本区块持有，须由页面据此刷新。
 */
'use client'

import { Sparkles } from 'lucide-react'
import { ItemGroup } from '@components/ui/item'
import { ListErrorAlert } from '@webview/components/ListErrorAlert'
import { LoadMoreSentinel } from '@webview/components/LoadMoreSentinel'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import { QueryRecordItem } from './QueryRecordItem'
import type { JSX } from 'react'
import { describeQueryListEmpty } from '../emptyState'
import { useQueryRecords } from '../hooks/useQueryRecords'

export interface QueryRecordSectionProps {
    /** 搜索词：与标注列表共用页面顶部输入框 */
    keyword: string
    /** 记录被删除后的通知：页头统计据此刷新，避免与列表条数不一致 */
    onRecordsChange?: () => void
}

export function QueryRecordSection({ keyword, onRecordsChange }: QueryRecordSectionProps): JSX.Element {
    const { items, isLoading, isLoadingMore, hasMore, error, loadMore, remove } = useQueryRecords(
        keyword,
        onRecordsChange,
    )
    // 条目数作为观察信号：与标注列表同一套「距底部 160px 预载」规则
    const sentinelRef = useScrollSentinel({ hasMore, onLoadMore: loadMore, observeKey: items.length })
    // 空态措辞（加载中 / 没有记录）由纯函数统一给出，标题与描述成对
    const emptyCopy = describeQueryListEmpty(isLoading)

    return (
        <div className="flex flex-col gap-2">
            {error === null ? null : <ListErrorAlert title="解释记录读取失败" error={error} />}
            {items.length === 0 && error === null ? (
                <StateEmpty
                    title={emptyCopy.title}
                    description={emptyCopy.description}
                    icon={Sparkles}
                    isLoading={isLoading}
                />
            ) : null}
            {items.length === 0 ? null : (
                <ItemGroup>
                    {items.map((item) => (
                        <QueryRecordItem key={item.id} item={item} onRemove={remove} />
                    ))}
                </ItemGroup>
            )}
            {hasMore ? <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={isLoadingMore} /> : null}
        </div>
    )
}
