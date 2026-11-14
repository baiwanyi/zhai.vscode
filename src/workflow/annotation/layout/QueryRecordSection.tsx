/**
 * AI 解释区块：标注页里的解释记录（按文本聚合），滚到底部自动续载。
 * 复用约定：条目取同目录 QueryRecordItem、空态取 StateEmpty、提示条取 Alert、转圈取 Spinner；
 * 数据、分页与删除编排在 hooks/useQueryRecords。
 * 关键约束：搜索复用页面顶部那一个输入框（keyword 由外部传入），本区块不自建搜索栏、不套卡片外壳；
 * 哨兵的 root 必须取页面 ScrollArea 的视口，与标注列表同一套「距底部 160px 预载」规则；
 * 只关心「文本 + 结果」，不展示来源文档、也不提供跳转，因此没有跳转失败的提示分支。
 */
import { Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { ItemGroup } from '@components/ui/item'
import { Spinner } from '@components/ui/spinner'
import { StateEmpty } from '@webview/components/StateEmpty'
import { QueryRecordItem } from './QueryRecordItem'
import type { JSX } from 'react'
import { useQueryRecords } from '../hooks/useQueryRecords'

/** 滚动视口标记：由 components/ui/scroll-area 的视口节点提供 */
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

/** 哨兵提前量：与标注列表保持一致 */
const SENTINEL_MARGIN = '160px'

export interface QueryRecordSectionProps {
    /** 搜索词：与标注列表共用页面顶部输入框 */
    keyword: string
}

export function QueryRecordSection({ keyword }: QueryRecordSectionProps): JSX.Element {
    const { items, isLoading, isLoadingMore, hasMore, error, loadMore, remove } = useQueryRecords(keyword)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!hasMore || sentinel === null) {
            return
        }
        const viewport = sentinel.closest(SCROLL_VIEWPORT_SELECTOR)
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    void loadMore()
                }
            },
            { root: viewport instanceof Element ? viewport : null, rootMargin: SENTINEL_MARGIN },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, items.length, loadMore])

    return (
        <div className="flex flex-col gap-2">
            {error === null ? null : (
                <Alert>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            {items.length === 0 ? (
                <StateEmpty
                    title={isLoading ? '正在读取 AI 解释' : '还没有 AI 解释'}
                    description={isLoading ? undefined : '在编辑区选中文字或点块把手，选择「询问 AI」'}
                    icon={Sparkles}
                    isLoading={isLoading}
                />
            ) : (
                <ItemGroup>
                    {items.map((item) => (
                        <QueryRecordItem key={item.id} item={item} onRemove={remove} />
                    ))}
                </ItemGroup>
            )}
            {hasMore ? (
                <div ref={sentinelRef} className="flex justify-center py-2">
                    <Spinner className={isLoadingMore ? 'size-4 text-muted-foreground' : 'invisible'} />
                </div>
            ) : null}
        </div>
    )
}
