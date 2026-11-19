/**
 * 热搜榜侧栏：右侧固定宽度卡片，展示实时榜单条目的序号、标题与标记。
 * 复用约定：卡片取 @components/ui/card，徽标取 @components/ui/badge，按钮取 Button，
 * 条目图标统一走 useWeiboImage 换本地地址（图床按 Referer 放行，Webview 直连会被拒）。
 * 关键约束：hooks 只能在组件内调用，故图标单独抽成 HotRankIcon，不能在 map 里直接调；
 * 前三名序号用 #f26d5f 加粗，其余弱化；description 与 icon_desc 各自成 badge，
 * icon_desc 的底色来自上游 icon_desc_color，并按底色亮度选前景色，避免浅底白字看不清。
 */
import { cn } from 'cn'
import { RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import { Spinner } from '@components/ui/spinner'
import type { WeiboHotRankItem } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { useWeiboHotRank } from '../hooks/useWeiboHotRank'
import { useWeiboImage } from '../hooks/useWeiboImage'

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

interface HotRankIconProps {
    url: string
    alt: string
}

/** 排行图标：取图完成前不占位，失败也不留空框 */
function HotRankIcon({ url, alt }: HotRankIconProps): JSX.Element | null {
    const { localUrl } = useWeiboImage(url)
    if (localUrl === null) {
        return null
    }
    return <img src={localUrl} alt={alt} className="size-4 shrink-0 rounded" loading="lazy" />
}

interface HotRankRowProps {
    item: WeiboHotRankItem
}

/** 单条榜单：序号 + 图标 + 标题 + 两个可选标记 */
function HotRankRow({ item }: HotRankRowProps): JSX.Element {
    const isTopRank = item.rank <= 3
    return (
        <li className="flex min-w-0 items-center gap-1.5">
            <span
                className={cn(
                    'w-4 shrink-0 text-right text-[0.7rem] tabular-nums',
                    isTopRank ? 'font-semibold' : 'text-muted-foreground',
                )}
                style={isTopRank ? { color: TOP_RANK_COLOR } : undefined}
            >
                {item.rank}
            </span>
            {item.iconUrl === null ? null : <HotRankIcon url={item.iconUrl} alt={item.title} />}
            <span className="min-w-0 flex-1 truncate text-xs" title={item.title}>
                {item.title}
            </span>
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
            {item.description === null ? null : (
                <Badge variant="secondary" className={cn(BADGE_CLASS, 'max-w-20 truncate')}>
                    {item.description}
                </Badge>
            )}
        </li>
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
            return <p className="text-muted-foreground text-xs">配置 Cookie 后显示实时热搜。</p>
        }
        if (state.isLoading && state.items.length === 0) {
            return (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" aria-hidden="true" />
                    正在读取热搜...
                </div>
            )
        }
        if (state.items.length === 0) {
            return (
                <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs">{state.errorMessage ?? '暂时没有热搜内容。'}</p>
                    <Button size="sm" variant="outline" onClick={handleRefresh}>
                        重试
                    </Button>
                </div>
            )
        }
        return (
            <>
                <ol className="flex flex-col gap-1.5">
                    {state.items.map((item) => (
                        <HotRankRow key={`${String(item.rank)}-${item.title}`} item={item} />
                    ))}
                </ol>
                <p className="text-muted-foreground text-[0.65rem]">榜单来自微博侧栏 realtime，点击刷新可更新</p>
            </>
        )
    }

    return (
        <Card>
            <CardContent className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium text-sm">微博热搜</h2>
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={handleRefresh}
                        isLoading={state.isLoading}
                        title="刷新热搜"
                    >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                    </Button>
                </div>
                {renderBody()}
            </CardContent>
        </Card>
    )
}
