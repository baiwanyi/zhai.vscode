/**
 * 微博顶部固定菜单：一级分组（首页 / 热门 / 热搜）在左，一条竖线之后是当前分组的二级频道。
 * 首页组的自建分组、热门组的频道都是运行时数据，直接续在固定项后面、同属二级：
 * 🏠 首页 🔥 热门 📈 热搜 │ 推荐 时间线 颜值 时尚 | 推荐 实时 同城 … ＋
 * 复用约定：容器与入口取 @components/ui/navigation-menu 的 List / Item / Link 槽位，分隔取 ui/separator；
 * 固定频道数据在 weiboNavGroups，自建分组与热门频道由页面从分组结果传入。
 * 热门组的「＋」是频道管理入口：上半区列已添加的（可移除），下半区列可添加的；
 * 只有推荐 / 实时 / 同城 / 榜单 四个固定频道不允许移除，小时榜等默认项同样可删可加。
 * 关键约束：点一级直接落到该组第一个可用频道（热门组没有固定项，就落到频道表首项）；
 * 一级、二级与动态频道都是前端状态而非路由，Link 用 asChild 换成 button 并重置原生边框、底色与字体；
 * 窄面板下整行允许换行，二级不缩成省略号，否则频道名认不出来；
 * 动态频道的标识统一走 toCustomGroupView / toHotChannelView，页面再用对应的 read* 还原 gid。
 */
import { cn } from 'cn'
import { Plus, X } from 'lucide-react'
import {
    NavigationMenu,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
} from '@components/ui/navigation-menu'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Separator } from '@components/ui/separator'
import { WEIBO_HOT_CHANNEL_LIMIT, WEIBO_PINNED_HOT_CHANNELS } from '@shared/types/weibo'
import type { WeiboGroupItem, WeiboHotChannel } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { toCustomGroupView, toHotChannelView, WEIBO_NAV_GROUPS } from './weiboNavGroups'
import type { WeiboNavGroup, WeiboNavItem, WeiboView } from './weiboNavGroups'
import type { JSX } from 'react'

/**
 * 聚焦底色：Link 默认的 focus 底色与 hover 同为 muted（只有 8% 叠色），键盘走到菜单上看不出焦点；
 * 这里改用 foreground 叠色（暗色主题下提亮、亮色主题下压深），并给激活项单独再叠一层，
 * 否则 data-active:focus:bg-muted 会把普通置覆盖回去。
 */
const FOCUS_CLASS = 'focus:bg-foreground/15 data-active:focus:bg-foreground/20'

/** 一级入口：图标 + 分组名，字号与字重比二级更重 */
const PRIMARY_CLASS = cn('border-0 bg-transparent px-2 py-1 font-medium', FOCUS_CLASS)

/** 二级频道与动态频道：小一号并弱化，激活时靠 data-active 回到正常前景 */
const SECONDARY_CLASS = cn(
    'border-0 bg-transparent px-2 py-0.5 text-xs text-muted-foreground data-active:text-foreground',
    FOCUS_CLASS,
)

/** 一级与二级之间的竖线：装饰性，读屏跳过 */
function NavDivider(): JSX.Element {
    return (
        <NavigationMenuItem aria-hidden="true" className="flex items-center px-1">
            <Separator orientation="vertical" className="h-4" />
        </NavigationMenuItem>
    )
}

/** 分组的动态二级：热门组取频道表，首页组取自建分组，其余分组没有动态项 */
function readDynamicItems(
    group: WeiboNavGroup | undefined,
    customGroups: readonly WeiboGroupItem[],
    hotChannels: readonly WeiboHotChannel[],
): WeiboNavItem[] {
    if (group?.hasCustomGroups === true) {
        return customGroups.map((item) => ({ view: toCustomGroupView(item.gid), label: item.title }))
    }
    if (group?.hasHotChannels === true) {
        return hotChannels.map((item) => ({ view: toHotChannelView(item.gid), label: item.title }))
    }
    return []
}

interface WeiboNavProps {
    active: WeiboView
    onSelect: (view: WeiboView) => void
    /** 账号自建分组：首页二级末尾追加，随分组结果更新 */
    customGroups: readonly WeiboGroupItem[]
    /** 已选的热门频道（默认预设 + 手动添加），顺序即菜单顺序 */
    hotChannels: readonly WeiboHotChannel[]
    /** 可补充的热门频道：allGroups 池里尚未显示的，供「+」弹层列出 */
    hotChannelCandidates: readonly WeiboHotChannel[]
    /** 添加一个频道：是否超限由页面判定，菜单只负责发起 */
    onAddHotChannel: (gid: string) => void
    /** 移除一个补充频道：默认预设不允许移除，菜单只在可移除项上暴露入口 */
    onRemoveHotChannel: (gid: string) => void
}

export function WeiboNav({
    active,
    onSelect,
    customGroups,
    hotChannels,
    hotChannelCandidates,
    onAddHotChannel,
    onRemoveHotChannel,
}: WeiboNavProps): JSX.Element {
    const isCustomGroupActive = customGroups.some((group) => toCustomGroupView(group.gid) === active)
    const isHotChannelActive = hotChannels.some((channel) => toHotChannelView(channel.gid) === active)
    /**
     * 当前所处的一级分组：停在运行时频道上时回落到对应分组 ——
     * 否则二级列表会整段消失，连回去的入口都看不到。
     */
    const homeGroup = WEIBO_NAV_GROUPS.find((group) => group.hasCustomGroups === true)
    const hotGroup = WEIBO_NAV_GROUPS.find((group) => group.hasHotChannels === true)
    const activeGroup =
        WEIBO_NAV_GROUPS.find((group) => group.items.some((item) => item.view === active)) ??
        (isCustomGroupActive ? homeGroup : isHotChannelActive ? hotGroup : undefined)
    const secondaryItems: WeiboNavItem[] = [
        ...(activeGroup?.items ?? []),
        ...readDynamicItems(activeGroup, customGroups, hotChannels),
    ]
    /** 还能不能再加：既要有候选，也不能超过上限 */
    const canAddHotChannel = hotChannels.length < WEIBO_HOT_CHANNEL_LIMIT && hotChannelCandidates.length > 0
    /**
     * 可移除的频道：只保护「固定频道」（推荐 / 实时 / 同城 / 榜单），
     * 小时榜、周榜等默认项与手动补充的频道一样可以删，删掉后回到候选池还能再加。
     * 判定按 gid 对比固定清单，不依赖数组顺序。
     */
    const removableHotChannels = hotChannels.filter(
        (channel) => !WEIBO_PINNED_HOT_CHANNELS.some((pinned) => pinned.gid === channel.gid),
    )
    /** 弹层是否值得打开：还有候选可加，或已有补充频道可删 */
    const canManageHotChannels = canAddHotChannel || removableHotChannels.length > 0

    return (
        <NavigationMenu viewport={false} className="max-w-none justify-start" aria-label="微博频道">
            <NavigationMenuList className="flex-wrap justify-start gap-0.5">
                {WEIBO_NAV_GROUPS.map((group) => {
                    const isGroupActive = group === activeGroup
                    return (
                        <NavigationMenuItem key={group.id}>
                            <NavigationMenuLink asChild data-active={isGroupActive ? '' : undefined}>
                                <button
                                    type="button"
                                    className={PRIMARY_CLASS}
                                    onClick={() => {
                                        // 一级点击落到该组第一个可用频道：热门组没有固定项，就落到频道表首项
                                        const first = [
                                            ...group.items,
                                            ...readDynamicItems(group, customGroups, hotChannels),
                                        ][0]
                                        if (first !== undefined) {
                                            onSelect(first.view)
                                        }
                                    }}
                                >
                                    <group.icon className="size-3.5" aria-hidden="true" />
                                    {group.label}
                                </button>
                            </NavigationMenuLink>
                        </NavigationMenuItem>
                    )
                })}
                <NavDivider />
                {secondaryItems.map((item) => (
                    <NavigationMenuItem key={item.view}>
                        <NavigationMenuLink asChild data-active={active === item.view ? '' : undefined}>
                            <button
                                type="button"
                                className={SECONDARY_CLASS}
                                aria-current={active === item.view ? 'page' : undefined}
                                onClick={() => {
                                    onSelect(item.view)
                                }}
                            >
                                {item.label}
                            </button>
                        </NavigationMenuLink>
                    </NavigationMenuItem>
                ))}
                {/* 热门频道的管理入口：添加与移除都在这里，只有「既没候选又没可移除项」时才置灰。
                    关键约束：不能按「是否还能添加」置灰 —— 名额用满时更需要的恰恰是移除 */}
                {activeGroup?.hasHotChannels === true ? (
                    <NavigationMenuItem>
                        <Popover>
                            <PopoverTrigger asChild>
                                {/* 用 Button 而不是裸 button：图标按钮的禁用态、focus ring 与悬停提示都由它统一，
                                    尺寸收到 size-5 与二级频道的行高对齐，颜色弱化到和频道名同级 */}
                                <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    className="size-5 text-muted-foreground"
                                    aria-label="管理热门频道"
                                    tooltip="管理热门频道"
                                    disabled={!canManageHotChannels}
                                >
                                    <Plus aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72">
                                <PopoverHeader>
                                    <PopoverTitle>热门频道</PopoverTitle>
                                    <PopoverDescription className="text-xs">
                                        已用 {hotChannels.length} / {WEIBO_HOT_CHANNEL_LIMIT}
                                        ，推荐 / 实时 / 同城 / 榜单 固定不可移除
                                    </PopoverDescription>
                                </PopoverHeader>
                                {removableHotChannels.length === 0 ? null : (
                                    <section className="flex flex-col gap-1">
                                        <p className="text-muted-foreground text-xs">已添加（点击移除）</p>
                                        <ul className="flex flex-wrap gap-1">
                                            {removableHotChannels.map((channel) => (
                                                <li key={channel.gid}>
                                                    {/* 整枚 chip 就是移除按钮：secondary 底色区分「已在菜单里」，
                                                        悬停转 destructive 提示这是删除 */}
                                                    <Button
                                                        size="xs"
                                                        variant="secondary"
                                                        className="hover:bg-destructive/15"
                                                        aria-label={`移除 ${channel.title}`}
                                                        onClick={() => {
                                                            onRemoveHotChannel(channel.gid)
                                                        }}
                                                    >
                                                        {channel.title}
                                                        <X data-icon="inline-end" aria-hidden="true" />
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}
                                <section className="flex flex-col gap-1">
                                    <p className="text-muted-foreground text-xs">可添加</p>
                                    {hotChannelCandidates.length === 0 ? (
                                        <p className="text-muted-foreground text-xs">当前账号没有更多可添加的频道。</p>
                                    ) : canAddHotChannel ? (
                                        // 候选池可能有几十个频道：限高滚动，避免弹层超出视口把「上传」等入口顶出屏幕
                                        <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                                            {hotChannelCandidates.map((channel) => (
                                                <li key={channel.gid}>
                                                    {/* 候选用 ghost：没有底色，与「已添加」的 secondary 形成「未选 / 已选」对比 */}
                                                    {/* 固定 w-16：候选名 2~4 字，等宽后每行三枚对齐成格，
                                                        不再随字数长短参差；超长名字交给内部 span 截断 */}
                                                    <Button
                                                        type="button"
                                                        size="xs"
                                                        variant="ghost"
                                                        className="w-16"
                                                        onClick={() => {
                                                            onAddHotChannel(channel.gid)
                                                        }}
                                                    >
                                                        <span className="truncate">{channel.title}</span>
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-muted-foreground text-xs">名额已满，先移除一个再添加。</p>
                                    )}
                                </section>
                            </PopoverContent>
                        </Popover>
                    </NavigationMenuItem>
                ) : null}
            </NavigationMenuList>
        </NavigationMenu>
    )
}
