/**
 * 热搜榜侧栏：右侧固定宽度卡片，展示实时榜单条目的序号、标题与标记。
 * 复用约定：卡片取 @components/ui/card，榜单容器取 ItemGroup，单条取 block/WeiboHotRankRow，
 * 未配置 / 加载 / 失败三态交给 block/WeiboHotRankFallback（专页共用同一份骨架）。
 * 关键约束：侧栏只渲染榜单前 10 条，完整回包仍由宿主缓存，调整展示条数只改一处常量；
 * 标题下的说明行显示取数时刻（宿主回包 fetchedAt 的本地时分），无值时保持空行，
 * 取数前后标题区不跳动；时刻由回包给出而非前端计时，刷新后与榜单内容同源；
 * 有内容时才渲染右上角刷新按钮，空榜单只保留空态里的「重试」，同一动作不开两个入口。
 */
import { RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { WeiboHotRankFallback } from '../block/WeiboHotRankFallback'
import { WeiboHotRankRow } from '../block/WeiboHotRankRow'
import { useWeiboHotRank } from '../hooks/useWeiboHotRank'

/** 侧栏展示条数：上游一次返回约 50 条，热搜卡只保留前 10 条，避免把侧栏拉得过长 */
const HOT_RANK_VISIBLE_COUNT = 10

interface WeiboHotRankListProps {
    /** 是否具备取数条件：未配置 Cookie 时只给引导，不发请求 */
    isEnabled: boolean
}

export function WeiboHotRankList({ isEnabled }: WeiboHotRankListProps): JSX.Element {
    const { state, refresh } = useWeiboHotRank({ isEnabled })

    const handleRefresh = useCallback((): void => {
        void refresh()
    }, [refresh])

    /** 更新时间：取宿主回包的 fetchedAt（ISO），按本地时分展示；空值或非法值整句不出现，不留「更新于」半句 */
    const updatedAt = state.fetchedAt === null ? '' : formatDateTime(state.fetchedAt)
    const updatedAtText = updatedAt === '' ? null : `更新于 ${updatedAt}`
    // 只渲染前 10 条：序号沿用上游 rank，截断后不会重新编号
    const visibleItems = state.items.slice(0, HOT_RANK_VISIBLE_COUNT)

    return (
        <Card>
            <CardHeader>
                <CardTitle>微博热搜</CardTitle>
                <CardDescription className="text-xs">{updatedAtText}</CardDescription>
                {/* 空榜单不显示刷新按钮：空态自带「重试」，同一动作不重复开两个入口 */}
                {state.items.length === 0 ? null : (
                    <CardAction>
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={handleRefresh}
                            isLoading={state.isLoading}
                            tooltip="刷新热搜"
                        >
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                        </Button>
                    </CardAction>
                )}
            </CardHeader>
            <CardContent className="px-1">
                {/* 空榜单（含未配置、加载、失败）统一交给占位组件，列表只负责有数据的那条分支 */}
                {state.items.length === 0 ? (
                    <WeiboHotRankFallback
                        variant="sidebar"
                        isEnabled={isEnabled}
                        state={state}
                        onRetry={handleRefresh}
                    />
                ) : (
                    // 间距交给 ItemGroup 自带的 xs 密度（gap-2），条目自身已压到 py-0.5，整体比默认列表紧凑
                    <ItemGroup>
                        {visibleItems.map((item) => (
                            <WeiboHotRankRow key={`${String(item.rank)}-${item.title}`} item={item} />
                        ))}
                    </ItemGroup>
                )}
            </CardContent>
        </Card>
    )
}
