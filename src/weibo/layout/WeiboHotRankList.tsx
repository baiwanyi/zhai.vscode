/**
 * 热搜榜侧栏：右侧固定宽度卡片，展示实时榜单条目的序号、标题与标记。
 * 复用约定：卡片取 @components/ui/card，榜单容器取 ItemGroup、单条取 @components/ui/item 的槽位
 * （标题走 ItemTitle、副行走 ItemDescription、标记收进 ItemActions），
 * 徽标取 @components/ui/badge，按钮取 Button，
 * 失败与空榜单统一走 StateEmpty（图标位给 Flame，重试入口作其底部操作区）。
 * 关键约束：条目只展示文字，上游的 icon_url 不再渲染成图片（回包字段仍保留，前端不取用）；
 * 前三名序号用 #f26d5f 加粗，其余弱化；description 作标题下的副行走 ItemDescription，
 * icon_desc 成行尾 badge，其底色来自上游 icon_desc_color，并按底色亮度选前景色，避免浅底白字看不清。
 * 条目整行可点：按标题打开 s.weibo.com 的搜索页，链接与 tooltip 的取舍见 HotRankRow 注释。
 * 标题下的说明行显示取数时刻（宿主回包 fetchedAt 的本地时分），无值时保持空行，
 * 取数前后标题区不跳动；时刻由回包给出而非前端计时，刷新后与榜单内容同源。
 */
import { cn } from 'cn'
import { ChevronRightIcon, Cookie, Flame, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import { Spinner } from '@components/ui/spinner'
import type { WeiboHotRankItem } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { TOOLTIP_CLASS, Tooltip, TooltipContent, TooltipTrigger } from '@webview/components/Tooltip'
import type { JSX, MouseEvent } from 'react'
import { useWeiboHotRank } from '../hooks/useWeiboHotRank'

/** 前三名的序号颜色：与需求给定的品牌红保持一致 */
const TOP_RANK_COLOR = '#f26d5f'

/** 徽标在窄侧栏里的统一尺寸：高度与字号都要比默认小一档 */
const BADGE_CLASS = 'h-4 shrink-0 px-1 text-[0.6rem] leading-none'

/** 短 hex 补成完整 6 位：非 hex 字面量返回 null，由调用方回落到白字 */
function expandHexColor(color: string): string | null {
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(color)
    if (short !== null) {
        const [, red, green, blue] = short
        if (red === undefined || green === undefined || blue === undefined) {
            return null
        }
        return `#${red}${red}${green}${green}${blue}${blue}`
    }
    return /^#[0-9a-f]{6}$/iu.test(color) ? color : null
}

/** 按底色亮度选前景色：亮底用深字，暗底与 rgb() 形式用白字 */
function pickBadgeForeground(color: string | null): string | undefined {
    if (color === null) {
        return undefined
    }
    const hex = expandHexColor(color)
    if (hex === null) {
        return '#ffffff'
    }
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    // 加权亮度近似：0.6 以上视为浅色底
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.6 ? '#1f1f1f' : '#ffffff'
}

interface HotRankRowProps {
    item: WeiboHotRankItem
}

/** 热搜搜索页：关键字按 URL 规则转码，标题里的 # 与空格都交给 encodeURIComponent */
function buildSearchUrl(title: string): string {
    return `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`
}

/** 标题链接只承担语义与键盘可达：阻止 webview 自身导航，点击冒泡回整行的打开动作 */
function preventNavigation(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()
}

/**
 * 单条榜单：序号 + 标题（可选描述与标记），槽位取 ui/item。
 * 关键约束：容器是 ItemGroup（自带 role="list"），条目直接就是 Item，不再套 li 语义，
 * 为配合父级的 list 角色在 Item 上补 role="listitem"；
 * 整行既是点击目标也是 Tooltip 的悬停目标：标题被 line-clamp-1 截断时才用得上完整文案，
 * 触发器就是 Item 本身（不是标题链接），鼠标扫到行内任意位置都会弹气泡；
 * 气泡固定暗底，暗色主题下与侧栏底色接近，调用处再叠 ring + shadow 勾出边界；
 * 悬停整行时行底铺 hover:bg-muted，标题、序号与描述一并提亮，靠 Item 自带的 group/item 驱动；
 * 点击走宿主 weibo/openPost（webview 内直接跳转会顶掉面板），
 * 标题链接只负责语义与键盘可达，导航一律阻止并冒泡回整行处理器，避免打开两次。
 */
function HotRankRow({ item }: HotRankRowProps): JSX.Element {
    const isTopRank = item.rank <= 3
    const searchUrl = buildSearchUrl(item.title)

    const handleOpen = useCallback((): void => {
        void request('weibo/openPost', { url: searchUrl }).catch(toastError)
    }, [searchUrl])

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Item size="xs" role="listitem" className="cursor-pointer p-1 hover:bg-muted" onClick={handleOpen}>
                    {/* 序号收进 ItemMedia 的图标位：宽度给在容器上、内容靠右对齐，两位数的 10 也不会把标题推歪 */}
                    <ItemMedia variant="icon" className="w-4 justify-end">
                        <span
                            className={cn(
                                'text-sm tabular-nums transition-colors',
                                isTopRank ? 'font-semibold' : 'text-muted-foreground group-hover/item:text-foreground',
                            )}
                            style={isTopRank ? { color: TOP_RANK_COLOR } : undefined}
                        >
                            {item.rank}
                        </span>
                    </ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                        {/* line-clamp-1 写在 flex 之后：ItemTitle 默认是 flex 行，cn 按 display 冲突取后者，
                            不显式声明就会保留 flex，长标题既不截断也不换行，直接把整行撑宽 */}
                        <ItemTitle className="line-clamp-1 w-full font-normal text-foreground">
                            {/* 整行才是悬停提示与点击的落点；这里的 a 只承担链接语义与键盘可达，
                                webview 自身的导航一律阻止，点击冒泡回整行的 handleOpen */}
                            <a
                                href={searchUrl}
                                className="text-inherit no-underline transition-colors group-hover/item:text-white"
                                onClick={preventNavigation}
                            >
                                {item.title}
                            </a>
                        </ItemTitle>
                        {/* 描述并入内容列而非行尾徽标：ItemDescription 自带 muted 前景，line-clamp-1 顶掉默认两行；
                            字号要加 !，否则 group-data-[size=xs]/item:text-xs 变体会盖过普通 text-[0.65rem] */}
                        {item.description === null ? null : (
                            <ItemDescription className="line-clamp-1 text-xs transition-colors group-hover/item:text-white">
                                {item.description}
                            </ItemDescription>
                        )}
                    </ItemContent>
                    <ItemActions className="shrink-0 gap-2">
                        {item.iconDesc === null ? null : (
                            <Badge
                                variant={item.iconDescColor === null ? 'default' : 'outline'}
                                className={BADGE_CLASS}
                                style={
                                    item.iconDescColor === null
                                        ? undefined
                                        : {
                                              backgroundColor: item.iconDescColor,
                                              color: pickBadgeForeground(item.iconDescColor),
                                          }
                                }
                            >
                                {item.iconDesc}
                            </Badge>
                        )}
                        <ChevronRightIcon className="size-4" />
                    </ItemActions>
                </Item>
            </TooltipTrigger>
            {/* 气泡放左侧：侧栏贴右边，向顶部弹会压住上一行；暗底亮字由 TOOLTIP_CLASS 统一给定。
                气泡底色是固定的 #1E1E1E，暗色主题下与侧栏底色几乎同值，只靠底色分不出边界，
                故在调用处追加 ring + shadow 勾出轮廓（遵循 Tooltip 出口「只追加不改造」的约定） */}
            <TooltipContent side="left" align="start" className={cn(TOOLTIP_CLASS, 'ring-1 ring-border shadow-lg')}>
                {item.title}
            </TooltipContent>
        </Tooltip>
    )
}

interface WeiboHotRankListProps {
    /** 是否具备取数条件：未配置 Cookie 时只给引导，不发请求 */
    isEnabled: boolean
}

export function WeiboHotRankList({ isEnabled }: WeiboHotRankListProps): JSX.Element {
    const { state, refresh } = useWeiboHotRank(isEnabled)

    const handleRefresh = useCallback((): void => {
        void refresh()
    }, [refresh])

    /** 主体：未配置 / 首次加载 / 失败 / 榜单 */
    function renderBody(): JSX.Element {
        if (!isEnabled) {
            // 与空态同形：只换图标与文案，操作入口在顶栏「更多」里，卡片内不再重复按钮
            return (
                <StateEmpty
                    className="gap-3 p-3"
                    icon={Cookie}
                    iconClassName="size-10 rounded-xl"
                    title="还没有配置微博 Cookie"
                    description="配置后即可读取实时热搜：先登录 weibo.com，再复制请求头里的完整 Cookie。"
                />
            )
        }
        if (state.isLoading && state.items.length === 0) {
            return (
                <StateEmpty className="p-3" icon={Spinner} iconClassName="size-10 rounded-xl" title="正在读取热搜..." />
            )
        }
        if (state.items.length === 0) {
            // 失败与空榜单共用同一套空态骨架：只有标题随原因切换，重试入口始终在下
            const isFailed = state.errorMessage !== null
            return (
                <StateEmpty
                    className="gap-3 p-3"
                    icon={Flame}
                    iconClassName="size-10 rounded-xl"
                    title={isFailed ? '热搜读取失败' : '暂时没有热搜内容'}
                    description={state.errorMessage ?? '稍后点右上角刷新再试，或确认 Cookie 是否仍然有效。'}
                >
                    <Button size="sm" variant="outline" onClick={handleRefresh}>
                        重试
                    </Button>
                </StateEmpty>
            )
        }
        return (
            // 间距交给 ItemGroup 自带的 xs 密度（gap-2），条目自身已压到 py-0.5，整体比默认列表紧凑
            <ItemGroup>
                {state.items.map((item) => (
                    <HotRankRow key={`${String(item.rank)}-${item.title}`} item={item} />
                ))}
            </ItemGroup>
        )
    }

    /** 更新时间：取宿主回包的 fetchedAt（ISO），按本地时分展示；空值或非法值整句不出现，不留「更新于」半句 */
    const updatedAt = state.fetchedAt === null ? '' : formatDateTime(state.fetchedAt)
    const updatedAtText = updatedAt === '' ? null : `更新于 ${updatedAt}`

    return (
        <Card>
            <CardHeader>
                <CardTitle>微博热搜</CardTitle>
                <CardDescription className="text-xs">{updatedAtText}</CardDescription>
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
            </CardHeader>
            <CardContent className="px-1">{renderBody()}</CardContent>
        </Card>
    )
}
