/**
 * 标注列表区块：提示条、错误条、空态与划线 / 批注条目，滚到底部自动续载。
 * 复用约定：容器与条目取同目录 AnnotationListItem，空态取 StateEmpty，提示条取 Alert；
 * 数据与状态仍由页面的 hooks/useAnnotationList 持有，本组件只负责呈现与「继续加载」的触发。
 * 关键约束：哨兵的 root 必须取页面 ScrollArea 的视口——webview 里滚动发生在这个容器内、body 不滚动，
 * 用默认视口会一次性全触发或永不触发；条目数变化时重建观察，首屏没填满才能链式补载；
 * 空态与转圈必须跟随 isLoading——首屏未回来时不能先闪「还没有标注」。
 */
import { Highlighter } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Spinner } from '@components/ui/spinner'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { StateEmpty } from '@webview/components/StateEmpty'
import { AnnotationListItem } from './AnnotationListItem'
import type { JSX } from 'react'

/** 滚动视口标记：由 components/ui/scroll-area 的视口节点提供 */
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

/** 哨兵提前量：距底部 160px 即预载下一页，减少滚动中的空窗 */
const SENTINEL_MARGIN = '160px'

export interface AnnotationListSectionProps {
    items: AnnotationRecord[]
    /** 首屏或续载中：空态、骨架与哨兵转圈都据此切换 */
    isLoading: boolean
    /** 列表加载失败：与跳转提示分开，避免一条提示盖住另一条 */
    error: string | null
    /** 跳转结果提示：文档缺失与定位失效由页面判定后传入 */
    notice: string | null
    hasMore: boolean
    onReveal: (id: string) => Promise<void>
    onUpdateColor: (id: string, color: HighlightColor) => Promise<void>
    onRemove: (id: string) => Promise<void>
    onLoadMore: () => Promise<void>
}

export function AnnotationListSection({
    items,
    isLoading,
    error,
    notice,
    hasMore,
    onReveal,
    onUpdateColor,
    onRemove,
    onLoadMore,
}: AnnotationListSectionProps): JSX.Element {
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
                    void onLoadMore()
                }
            },
            { root: viewport instanceof Element ? viewport : null, rootMargin: SENTINEL_MARGIN },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, items.length, onLoadMore])

    return (
        <>
            {notice === null ? null : (
                <Alert>
                    <AlertDescription>{notice}</AlertDescription>
                </Alert>
            )}
            {error === null ? null : (
                <Alert>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            {items.length === 0 ? (
                <StateEmpty
                    title={isLoading ? '正在读取标注' : '还没有标注'}
                    description={isLoading ? undefined : '在编辑区选中文字，即可划线或添加批注'}
                    icon={Highlighter}
                    isLoading={isLoading}
                />
            ) : (
                <div className="flex flex-col gap-2">
                    {items.map((item) => (
                        <AnnotationListItem
                            key={item.id}
                            item={item}
                            onReveal={onReveal}
                            onUpdateColor={onUpdateColor}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            )}
            {hasMore ? (
                <div ref={sentinelRef} className="flex justify-center py-2">
                    <Spinner className={isLoading ? 'size-4 text-muted-foreground' : 'invisible'} />
                </div>
            ) : null}
        </>
    )
}
