/**
 * 热搜榜单条：序号 + 标题（可选描述与标记），只给侧栏热搜卡使用（专页有自己的行组件）。
 * 复用约定：槽位取 @components/ui/item（ItemTitle / ItemDescription / ItemActions），
 * 徽标交给同目录 WeiboHotRankBadge，搜索地址与打开动作来自 hooks/useWeiboSearchOpen，
 * 链接处理器取 utils/weiboHotLinks，悬停提示取 @webview/components/Tooltip 的 TOOLTIP_CLASS。
 * 关键约束：容器必须是 ItemGroup（自带 role="list"），条目在 Item 上补 role="listitem"；
 * 上游 icon_url 不再渲染成图片；连点由 hook 的节流窗口兜住，行内不再各写一份。
 */
import { ChevronRightIcon } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type { WeiboHotRankItem } from '@shared/types/weibo'
import { TOOLTIP_CLASS, Tooltip, TooltipContent, TooltipTrigger } from '@webview/components/Tooltip'
import { WeiboHotRankBadge } from './WeiboHotRankBadge'
import { WeiboHotRankPosition } from './WeiboHotRankPosition'
import type { JSX } from 'react'
import { useWeiboSearchOpen } from '../hooks/useWeiboSearchOpen'
import { preventLinkNavigation } from '../utils/weiboHotLinks'

export interface WeiboHotRankRowProps {
    item: WeiboHotRankItem
}

/**
 * 单条榜单：序号 + 标题（可选描述与标记），槽位取 ui/item。
 * 关键约束：整行既是点击目标也是 Tooltip 的悬停目标，标题被截断时才用得上完整文案；
 * 点击走宿主 weibo/openPost（webview 内直接跳转会顶掉面板），
 * 标题链接只负责语义与键盘可达，导航一律阻止并冒泡回整行处理器，避免打开两次。
 */
export function WeiboHotRankRow({ item }: WeiboHotRankRowProps): JSX.Element {
    const { searchUrl, openSearch } = useWeiboSearchOpen(item.title)

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Item size="xs" role="listitem" className="cursor-pointer p-1 hover:bg-muted" onClick={openSearch}>
                    {/* 序号与前三名高亮交给 WeiboHotRankPosition：媒体宽度、字号与颜色一并在那一份里 */}
                    <WeiboHotRankPosition rank={item.rank} size="sm" />
                    <ItemContent className="min-w-0 gap-0.5">
                        {/* line-clamp-1 写在 flex 之后：ItemTitle 默认是 flex 行，cn 按 display 冲突取后者，
                            不显式声明就会保留 flex，长标题既不截断也不换行，直接把整行撑宽 */}
                        <ItemTitle className="line-clamp-1 w-full font-normal text-foreground">
                            {/* 整行才是悬停提示与点击的落点；这里的 a 只承担链接语义与键盘可达，
                                webview 自身的导航一律阻止，点击冒泡回整行的 openSearch */}
                            <a
                                href={searchUrl}
                                className="text-inherit no-underline transition-colors group-hover/item:text-foreground"
                                onClick={preventLinkNavigation}
                            >
                                {item.title}
                            </a>
                        </ItemTitle>
                        {/* 描述并入内容列而非行尾徽标：ItemDescription 自带 muted 前景，line-clamp-1 顶掉默认两行 */}
                        {item.description === null ? null : (
                            <ItemDescription className="line-clamp-1 text-xs transition-colors group-hover/item:text-foreground">
                                {item.description}
                            </ItemDescription>
                        )}
                    </ItemContent>
                    <ItemActions className="shrink-0 gap-2">
                        <WeiboHotRankBadge item={item} size="sm" />
                        <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </ItemActions>
                </Item>
            </TooltipTrigger>
            <TooltipContent className={TOOLTIP_CLASS}>{item.title}</TooltipContent>
        </Tooltip>
    )
}
