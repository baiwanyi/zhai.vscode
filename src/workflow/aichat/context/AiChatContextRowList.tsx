/**
 * 上下文列表：ScrollArea 内三态（空态 / 首屏加载 / 行列表），滚到底由续载哨兵上报下一批意图。
 * 复用约定：行取同目录 AiChatContextRow，滚动观察与解绑交给 @webview/hooks/useScrollSentinel，
 * 底部占位取 @webview/blocks/LoadMoreSentinel，行模型仍对调用方泛型。
 * 关键约束：限高与内容盒必须落在 Viewport——Radix 在 Viewport 里套了一层
 * `min-width:100%; display:table` 的测量层，长标题会把它撑成横向溢出并让行内 truncate 失效，
 * 该层是内联样式，只能用 ! 改回 block；
 * 哨兵只在真需要续载时渲染（来源列表一次给全量），否则底部会多出一段空白。
 */
import { ScrollArea } from '@components/ui/scroll-area'
import { Spinner } from '@components/ui/spinner'
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import { AiChatContextRow } from './AiChatContextRow'
import type { JSX } from 'react'

/**
 * 列表高度上限与内容盒：限高落在 Viewport；Radix 还在 Viewport 里套了一层
 * `min-width:100%; display:table` 的测量层（内联样式），长标题会把这一层撑成横向溢出、
 * 让行内 truncate 失效——必须把这层改回 block（内联样式只能用 ! 覆盖）。
 */
const VIEWPORT_CLASS =
    'min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-80 [&_[data-slot=scroll-area-viewport]>div]:block!'

/** 空回调：未接入续载时占位，避免每次渲染新建函数把观察器重建掉 */
const NOOP = (): void => undefined

/** 加载态：空列表首屏加载用的居中 Spinner，不再输出文案 */
function LoadingRow(): JSX.Element {
    return (
        <div className="flex justify-center px-2 py-1.5">
            <Spinner className="size-3.5" aria-label="正在加载" />
        </div>
    )
}

export interface AiChatContextRowListProps<T> {
    items: readonly T[]
    /** 行标识：只作 React key */
    getKey: (item: T) => string
    /** 主文案：过长按列宽截断 */
    getTitle: (item: T) => string
    /** 右侧辅助信息：返回 undefined 即不渲染；最长占行宽三分之一 */
    getMeta?: (item: T) => string | undefined
    /** 行首图标：返回节点即渲染在标题之前 */
    renderRowIcon?: (item: T) => JSX.Element
    isLoading: boolean
    emptyText: string
    onPick: (item: T) => void
    /** 滚动到底继续加载：不传即停用续载，底部也不再渲染哨兵 */
    onScrollBottom?: () => void
    /** 是否还有下一批：为假时不挂观察器，避免一屏没填满时反复触发空请求 */
    hasMore?: boolean
    /** 非菜单场景（作品浮层）：行渲染为普通按钮，不依赖菜单上下文 */
    isPlain?: boolean
}

export function AiChatContextRowList<T>({
    items,
    getKey,
    getTitle,
    getMeta,
    renderRowIcon,
    isLoading,
    emptyText,
    onPick,
    onScrollBottom,
    hasMore = false,
    isPlain = false,
}: AiChatContextRowListProps<T>): JSX.Element {
    const sentinelRef = useScrollSentinel({
        hasMore: hasMore && onScrollBottom !== undefined,
        onLoadMore: onScrollBottom ?? NOOP,
        observeKey: items.length,
    })

    return (
        <ScrollArea className={VIEWPORT_CLASS}>
            {items.length === 0 ? (
                isLoading ? (
                    <LoadingRow />
                ) : (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</div>
                )
            ) : (
                <div className="pl-1 pr-3">
                    {items.map((item) => (
                        <AiChatContextRow
                            key={getKey(item)}
                            item={item}
                            getTitle={getTitle}
                            getMeta={getMeta}
                            renderRowIcon={renderRowIcon}
                            isPlain={isPlain}
                            onPick={onPick}
                        />
                    ))}
                    {onScrollBottom === undefined ? null : (
                        <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={isLoading} />
                    )}
                </div>
            )}
        </ScrollArea>
    )
}
