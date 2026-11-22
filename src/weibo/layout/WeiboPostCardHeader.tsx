/**
 * 卡片头部：作者头像与名称、标题行的 @UID 链接、时间来源，以及右侧的阅读数徽标、关注按钮与「更多」菜单。
 * 复用约定：作者名交给 WeiboAuthorName、头像交给 WeiboAvatar、@UID 与正文链接共用 WeiboLink；
 * 关注态与写操作全部由 useWeiboAuthorFollow 的控制器注入，本组件不直接发请求。
 * 关键约束：未关注时关注按钮可点，关注成功后变「已关注」并禁用；取关只在「更多」菜单里，
 * 两者互斥；作者 uid 或名字缺失时对应入口一并收起，不拼空地址、不写空名单；
 * 个人主页用 hideFollow 收起整组关注入口（含菜单里的取消关注），关注只由页头按钮负责；
 * 阅读数只在「作者 uid 等于当前账号」且上游确实下发时展示，别人的微博不显示、缺失也不补 0。
 */
import { Ban, ExternalLink, Eye, MoreHorizontal, UserCheck, UserMinus, UserPlus } from 'lucide-react'
import { CardAction, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { StatBadge } from '@webview/components/StatBadge'
import type { WeiboAuthorFollowController } from '@webview/weibo/hooks/useWeiboAuthorFollow'
import { formatWeiboCount } from '@webview/weibo/utils/weiboCount'
import { buildProfileUrl } from '@webview/weibo/utils/weiboLinks'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import type { JSX } from 'react'
import { WeiboAuthorName } from '../block/WeiboAuthorName'
import { WeiboAvatar } from '../block/WeiboAvatar'
import { WeiboLink } from '../block/WeiboRichText'

export interface WeiboPostCardHeaderProps {
    post: WeiboTimelinePost
    /** 关注控制器：状态、进行态与写操作都由它给出 */
    follow: WeiboAuthorFollowController
    /** 在浏览器打开本条原文 */
    onOpen: () => void
    /** 屏蔽该博主：名字交给面板写入屏蔽名单，当前列表随之过滤掉该条 */
    onBlockAuthor?: (authorName: string) => void
    /** 隐藏关注入口：个人主页的关注由页头统一负责，列表卡片不再重复 */
    hideFollow?: boolean
    /** 当前登录账号 uid：只有本人发的微博才展示阅读数 */
    viewerUid?: string | null
}

export function WeiboPostCardHeader({
    post,
    follow,
    onOpen,
    onBlockAuthor,
    hideFollow = false,
    viewerUid = null,
}: WeiboPostCardHeaderProps): JSX.Element {
    // 阅读数只对自己可见：上游也只在本人微博上带 reads_count，这里再按 uid 兜一层
    const isAuthorSelf = viewerUid !== null && viewerUid === post.author.id
    const readsCount = isAuthorSelf ? post.readsCount : null
    return (
        <CardHeader>
            <div className="flex items-start gap-3">
                <WeiboAvatar
                    name={post.author.name.length > 0 ? post.author.name : '未'}
                    avatarUrl={post.author.avatarUrl}
                />
                <div className="min-w-0 flex-1">
                    <CardTitle className="flex flex-wrap items-center gap-1 text-sm">
                        <WeiboAuthorName
                            name={post.author.name}
                            isVerified={post.author.isVerified}
                            fallback="未知作者"
                        />
                        {post.author.id.length > 0 ? (
                            <WeiboLink
                                className="ml-1 shrink-0 text-muted-foreground hover:text-link dark:text-muted-foreground"
                                text={`@${post.author.id}`}
                                url={buildProfileUrl(post.author.id)}
                            />
                        ) : null}
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="shrink-0">{formatWeiboTime(post.createdAt, post.createdAtRaw)}</span>
                        {post.source.length > 0 ? <span className="shrink-0">来自 {post.source}</span> : null}
                    </CardDescription>
                </div>
            </div>
            {/* 关注按钮常驻：未关注可点，关注成功后变「已关注」并禁用；取关收进「更多」菜单，
                原文与「屏蔽该博主」同样在菜单里，两个卡片动作已移到底栏，头部不再堆按钮 */}
            <CardAction className="flex items-center gap-1">
                {follow.canFollow && !hideFollow ? (
                    <Button
                        variant="outline"
                        size="sm"
                        tooltip={follow.isFollowing ? '已关注该博主' : '关注该博主'}
                        aria-label={follow.isFollowing ? '已关注该博主' : '关注该博主'}
                        isLoading={follow.isFollowPending}
                        disabled={follow.isFollowing}
                        onClick={() => {
                            follow.toggleFollow(true)
                        }}
                    >
                        {follow.isFollowing ? <UserCheck /> : <UserPlus />}
                        {follow.isFollowing ? '已关注' : '关注'}
                    </Button>
                ) : null}
                {/* 阅读数只有本人微博才有：统计胶囊（眼睛 + 折算值），精确口径走悬停提示 */}
                {readsCount === null ? null : (
                    <StatBadge className="shrink-0" tooltip={`阅读 ${formatWeiboCount(readsCount)}`}>
                        <Eye className="size-4" aria-hidden="true" />
                        {formatWeiboCount(readsCount)}
                    </StatBadge>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" tooltip="更多操作" aria-label="更多操作">
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={onOpen}>
                                <ExternalLink />
                                在浏览器打开原文
                            </DropdownMenuItem>
                            {/* 取消关注只在已关注时出现：头部按钮此时是禁用的「已关注」，取关只能走这里；
                                个人主页里关注入口整体收进页头，菜单项同样不再重复 */}
                            {follow.canFollow && follow.isFollowing && !hideFollow ? (
                                <DropdownMenuItem
                                    onSelect={() => {
                                        follow.toggleFollow(false)
                                    }}
                                >
                                    <UserMinus />
                                    取消关注
                                </DropdownMenuItem>
                            ) : null}
                            {/* 屏蔽是破坏性动作：单独分隔，作者名缺失时没有可加入名单的值，直接禁用 */}
                            {onBlockAuthor === undefined ? null : (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={post.author.name.trim().length === 0}
                                        onSelect={() => {
                                            onBlockAuthor(post.author.name)
                                        }}
                                    >
                                        <Ban />
                                        屏蔽该博主
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardAction>
        </CardHeader>
    )
}
