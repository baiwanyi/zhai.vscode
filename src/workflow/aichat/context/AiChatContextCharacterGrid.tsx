/**
 * 人物候选网格：一位人物一个按钮——性别图标 + 人名 + 角色徽标，点击即加入，可连续点多位。
 * 复用约定：性别与角色标签由宿主从人物卡的「分类 / 性别」字段读出（AiContextItem.genderLabel / roleLabel），
 * 图标取 lucide-react 的 Mars / Venus（与人物列表同源，男蓝女红），徽标取 @webview/blocks/Badge；
 * 续载哨兵取 @webview/hooks/useScrollSentinel + @webview/blocks/LoadMoreSentinel，与候选列表同一套。
 * 关键约束：性别标签缺失（旧文档没写）时用中性人形图标兜底，角色标签缺失则不渲染徽标；
 * 根节点自带滚动、高度由父级 flex 决定（作品面板固定 h-80），不要在内部再套限高。
 */
import { Mars, UserRound, Venus } from 'lucide-react'
import { Spinner } from '@components/ui/spinner'
import type { AiContextItem } from '@shared/types/aiChat'
import { Badge } from '@webview/blocks/Badge'
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { JSX } from 'react'
import { CONTEXT_PICK_BUTTON_CLASS } from '../utils/context/styles'

/** 空回调：未接入续载时占位，避免每次渲染新建函数把观察器重建掉 */
const NOOP = (): void => undefined

/** 性别标签到图标：文档里存的是中文标签，未写时用中性人形 */
function genderIconOf(label: string | undefined): JSX.Element {
    if (label === '女') {
        return <Venus className="size-3.5 shrink-0 text-chart-5" role="img" aria-label="女" />
    }
    if (label === '男') {
        return <Mars className="size-3.5 shrink-0 text-chart-1" role="img" aria-label="男" />
    }
    return <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
}

export interface AiChatContextCharacterGridProps {
    items: readonly AiContextItem[]
    isLoading: boolean
    emptyText: string
    onPick: (item: AiContextItem) => void
    /** 滚动到底继续加载：不传即停用续载 */
    onScrollBottom?: () => void
    /** 是否还有下一批：为假时不挂观察器，避免一屏没填满时反复触发空请求 */
    hasMore?: boolean
}

export function AiChatContextCharacterGrid({
    items,
    isLoading,
    emptyText,
    onPick,
    onScrollBottom,
    hasMore = false,
}: AiChatContextCharacterGridProps): JSX.Element {
    const sentinelRef = useScrollSentinel({
        hasMore: hasMore && onScrollBottom !== undefined,
        onLoadMore: onScrollBottom ?? NOOP,
        observeKey: items.length,
    })

    if (items.length === 0) {
        return isLoading ? (
            <div className="flex min-h-0 flex-1 justify-center px-2 py-1.5">
                <Spinner className="size-3.5" aria-label="正在加载" />
            </div>
        ) : (
            <div className="min-h-0 flex-1 px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</div>
        )
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="grid grid-cols-3 content-start gap-1.5 p-1">
                {items.map((item) => (
                    <button
                        key={`${item.path}-${item.startLine ?? ''}`}
                        type="button"
                        className={CONTEXT_PICK_BUTTON_CLASS}
                        onClick={(): void => onPick(item)}
                    >
                        {genderIconOf(item.genderLabel)}
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.roleLabel === undefined || item.roleLabel.length === 0 ? null : (
                            <Badge variant="secondary" className="shrink-0">
                                {item.roleLabel}
                            </Badge>
                        )}
                    </button>
                ))}
            </div>
            {onScrollBottom === undefined ? null : <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={isLoading} />}
        </div>
    )
}
