/**
 * 热搜专页：右侧菜单（我的 / 热搜 / 文娱 / 社会 / 科技 / 生活 / 体育 / ACG / 同城）的内容区，
 * 一个标签对应网页端一张榜单端点，整页展示该榜单的全部条目。
 * 复用约定：卡片取 @components/ui/card，列表容器取 ItemGroup、单条由本文件的 HotSearchRow 承载
 * （专页有自己的行样式，不复用侧栏卡片那一份），徽标与名次取 block/WeiboHotRankBadge / WeiboHotRankPosition，
 * 搜索地址与打开动作取 hooks/useWeiboSearchOpen，三态占位取 block/WeiboHotRankFallback。
 * 关键约束：取数由面板层统一持有，刷新统一走顶栏「刷新」，页面内不再重复刷新按钮；
 * 热搜只在专页出现，右侧不再渲染侧栏热搜卡；未配置 Cookie 时不发请求，只给配置引导；
 * 榜单行之间用 ItemSeparator 分隔，最后一条不加；同城榜的 citycode 来自设置弹窗，
 * 城市未读取完成时按默认城市展示。
 */
import { MapPin } from 'lucide-react'
import { Fragment } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@components/ui/item'
import type { WeiboHotRankItem } from '@shared/types/weibo'
import { WEIBO_DEFAULT_CITY_CODE, readWeiboCityName } from '@shared/types/weibo'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { readHotRankTab, readWeiboViewItemLabel } from './weiboNavGroups'
import type { WeiboHotRankState } from '../hooks/useWeiboHotRank'
import type { WeiboView } from './weiboNavGroups'
import type { JSX } from 'react'
import { WeiboHotRankBadge } from '../block/WeiboHotRankBadge'
import { WeiboHotRankFallback } from '../block/WeiboHotRankFallback'
import { WeiboHotRankPosition } from '../block/WeiboHotRankPosition'
import { useWeiboSearchOpen } from '../hooks/useWeiboSearchOpen'

interface HotSearchRowProps {
    item: WeiboHotRankItem
}

/**
 * 专页榜单行：序号 + 标题 + 行尾描述与标记，整行点击打开搜索页。
 * 关键约束：页面宽度足够，行内不挂 Tooltip，标题单行截断即可看全大意；
 * 标题只作文本、整行才是点击目标——行内不写带 href 的 a，否则 webview 会交给系统浏览器。
 */
function HotSearchRow({ item }: HotSearchRowProps): JSX.Element {
    const { openSearch } = useWeiboSearchOpen(item.title)

    return (
        <Item size="sm" role="listitem" className="cursor-pointer gap-3 hover:bg-muted" onClick={openSearch}>
            {/* 序号与前三名高亮交给 WeiboHotRankPosition：媒体宽度、字号与颜色一并在那一份里 */}
            <WeiboHotRankPosition rank={item.rank} size="md" />
            <ItemContent className="min-w-0 gap-0.5">
                {/* 标题只作文本：整行才是点击目标。这里不能写带 href 的 a，
                    webview 会把 href 交给系统浏览器，行内点击就会顶掉面板 */}
                <ItemTitle className="line-clamp-1 w-full text-lg font-normal text-foreground">{item.title}</ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0 gap-2">
                {item.description === null ? null : (
                    <div className="line-clamp-1 max-w-40 shrink-0 text-xs">{item.description}</div>
                )}
                <WeiboHotRankBadge item={item} size="md" />
            </ItemActions>
        </Item>
    )
}

interface HotSearchViewProps {
    /** 是否已配置 Cookie：未配置只给引导，不发请求 */
    isEnabled: boolean
    /** 当前热搜频道：由顶栏菜单选中 */
    view: WeiboView
    /** 同城榜的城市代码：来自设置弹窗，未读取完成时为空串 */
    cityCode: string
    /** 当前榜单状态：由面板层持有，顶栏刷新与本页共用同一份 */
    state: WeiboHotRankState
    /** 刷新当前榜单：与顶栏「刷新」是同一个动作 */
    onRefresh: () => void
    /** 打开设置：同城榜改城市的入口 */
    onOpenSettings: () => void
}

export function HotSearchView({
    isEnabled,
    view,
    cityCode,
    state,
    onRefresh,
    onOpenSettings,
}: HotSearchViewProps): JSX.Element {
    // 视图一定在热搜组内：映射不到时按「热搜」榜兜底，避免把 band 侧栏榜混进来
    const tab = readHotRankTab(view) ?? 'hotSearch'
    const isCity = tab === 'city'
    const effectiveCityCode = cityCode.length > 0 ? cityCode : WEIBO_DEFAULT_CITY_CODE
    const cityName = readWeiboCityName(effectiveCityCode)
    const tabLabel = readWeiboViewItemLabel(view) || '热搜'
    /** 同城空榜的补充说明：让用户知道是城市没内容，而不是榜单坏了 */
    const emptyHint = isCity ? `当前城市「${cityName}」暂无榜单，稍后刷新，或在设置里换一个城市。` : undefined

    const updatedAt = state.fetchedAt === null ? '' : formatDateTime(state.fetchedAt)
    const description = [isCity ? `同城 · ${cityName}` : '', updatedAt === '' ? '' : `更新于 ${updatedAt}`]
        .filter((part) => part.length > 0)
        .join(' · ')

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-xl font-light">热搜 · {tabLabel}</CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
                {isCity ? (
                    // 城市入口只在同城榜出现：点开即设置弹窗，改完下拉立刻重取这张榜
                    <CardAction>
                        <Button size="xs" variant="ghost" onClick={onOpenSettings} tooltip="切换同城城市">
                            <MapPin className="size-3.5" aria-hidden="true" />
                            {cityName}
                        </Button>
                    </CardAction>
                ) : null}
            </CardHeader>
            <CardContent className="px-1">
                {/* 空榜单（含未配置、加载、失败）统一交给占位组件，列表只负责有数据的那条分支 */}
                {state.items.length === 0 ? (
                    <WeiboHotRankFallback
                        variant="page"
                        isEnabled={isEnabled}
                        state={state}
                        onRetry={onRefresh}
                        onOpenSettings={onOpenSettings}
                        emptyHint={emptyHint}
                    />
                ) : (
                    // 行间用 ItemSeparator 分隔，最后一条不加；间距压到 gap-1 让分隔线贴合条目
                    <ItemGroup className="gap-1">
                        {state.items.map((item, index) => (
                            <Fragment key={`${String(item.rank)}-${item.title}`}>
                                <HotSearchRow item={item} />
                                {index < state.items.length - 1 ? <ItemSeparator className="bg-muted my-0" /> : null}
                            </Fragment>
                        ))}
                    </ItemGroup>
                )}
            </CardContent>
        </Card>
    )
}
