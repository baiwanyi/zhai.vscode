/**
 * 个人主页：页内打开的他人资料页头 + 该用户的微博列表，替代跳转到浏览器看主页。
 * 复用约定：页头取 @components/ui/card 槽位，头像取 block/WeiboAvatar、认证角标取 WeiboAuthorName，
 * 计数按 utils/weiboCount 折算；关注动作交给同目录 UserFollowAction，列表交给 WeiboFeedSection
 * （凭证门 + 加载态 + 空态 + 翻页），单条仍是 WeiboPostCard，与首页信息流完全同形。
 * 关键约束：取数不在本组件内发起，控制器由页面层持有，顶栏「刷新」与页头共用同一份；
 * 资料未到货（含未加载完、读取失败）时整块页头不渲染，只在列表区展示加载态或错误；
 * 封面固定占位高度，图片到货只替换内容，不让整卡跳动；头像与封面都经宿主图片代理加载；
 * 备注保存后重新拉一页列表，并把列表里该用户的作者名换成备注（展示层替换，不改上游数据）；
 * 返回按钮只发起回调，视图切换由页面层决定；列表卡片不再重复关注入口（关注只在页头）；
 * 主页是当前登录账号本人时（uid 相同）不渲染关注入口，避免给自己点关注。
 */
import { ArrowLeft, MapPin, Mars, Venus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import type { WeiboCredentialState, WeiboUserInfo } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { UserFollowAction } from './UserFollowAction'
import { WeiboFeedSection } from './WeiboFeedSection'
import type { WeiboUserBlogController } from '../hooks/useWeiboUserBlog'
import type { JSX } from 'react'
import { WeiboAuthorName } from '../block/WeiboAuthorName'
import { WeiboAvatar } from '../block/WeiboAvatar'
import { useWeiboImage } from '../hooks/useWeiboImage'
import { formatWeiboCount } from '../utils/weiboCount'

/** 封面固定高度：与占位块一致，图片加载完成只替换内容，卡片高度不跳 */
const COVER_HEIGHT_CLASS = 'h-64'

/** 封面图片铺满固定容器 */
const COVER_IMAGE_CLASS = 'absolute inset-0 size-full object-cover'

/**
 * 封面：容器始终占住 96px，加载中与失败都保持同一块底。
 * 关键约束：图片绝对定位填充，不参与高度计算——否则大图解码前后会把卡片顶开再收回。
 */
function UserCover({ url }: { url: string }): JSX.Element {
    const { localUrl, isFailed } = useWeiboImage(url)
    const hasImage = url.length > 0 && !isFailed && localUrl !== null
    return (
        <div
            className={`relative w-full overflow-hidden bg-linear-to-r from-muted to-accent ${COVER_HEIGHT_CLASS}`}
            aria-hidden={hasImage ? undefined : 'true'}
        >
            {hasImage ? <img src={localUrl} alt="" className={COVER_IMAGE_CLASS} loading="lazy" /> : null}
        </div>
    )
}

/** 性别图标：男用蓝色、女用粉色区分，未知不渲染（不写文字缩写，保持资料行干净） */
function GenderIcon({ gender }: { gender: WeiboUserInfo['gender'] }): JSX.Element | null {
    if (gender === 'm') {
        return <Mars className="size-3 shrink-0 text-sky-500" role="img" aria-label="男" />
    }
    if (gender === 'f') {
        return <Venus className="size-3 shrink-0 text-pink-500" role="img" aria-label="女" />
    }
    return null
}

/** 计数行：关注 / 粉丝 / 微博，与账号菜单同口径折算 */
function describeCounts(user: WeiboUserInfo): string {
    return `${formatWeiboCount(user.friendsCount)} 关注 · ${formatWeiboCount(user.followersCount)} 粉丝 · ${formatWeiboCount(user.statusesCount)} 微博`
}

interface UserProfileCardProps {
    /** 资料：调用方只在资料到货后渲染本组件，所以这里是非空值 */
    user: WeiboUserInfo
    /** 当前生效的备注名：空串表示没有备注 */
    remark: string
    /** 主页是否就是当前登录账号本人：是本人则不给关注入口 */
    isSelf: boolean
    onBack: () => void
    /** 备注保存成功：页面据此刷新列表并让作者名改用备注 */
    onRemarkSaved: (remark: string) => void
}

/** 资料页头：封面 + 头像 + 昵称 + 简介 + 计数，返回与关注固定在右上 */
function UserProfileCard({ user, remark, isSelf, onBack, onRemarkSaved }: UserProfileCardProps): JSX.Element {
    const locationText = user.location
    const hasLocation = locationText.length > 0
    const hasGender = user.gender !== 'unknown'

    return (
        // 封面自带高度与底色：顶部内边距去掉，封面才能贴齐卡片上沿
        <Card className="pt-0">
            <UserCover url={user.coverUrl} />
            <CardHeader>
                <div className="flex items-start gap-3">
                    <WeiboAvatar name={user.name} avatarUrl={user.avatarUrl} className="size-14" />
                    <div className="min-w-0 flex-1">
                        <CardTitle className="flex flex-wrap items-center gap-1 text-base">
                            <WeiboAuthorName name={user.name} isVerified={user.isVerified} fallback="用户主页" />
                        </CardTitle>
                        {hasLocation || hasGender ? (
                            <CardDescription className="mt-1 flex items-center gap-1 text-xs">
                                {hasLocation ? (
                                    <>
                                        <MapPin className="size-3 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0 truncate">{locationText}</span>
                                    </>
                                ) : null}
                                {hasGender ? <GenderIcon gender={user.gender} /> : null}
                            </CardDescription>
                        ) : null}
                    </div>
                </div>
                <CardAction className="flex items-center gap-1">
                    <Button size="icon" variant="secondary" tooltip="返回" aria-label="返回" onClick={onBack}>
                        <ArrowLeft className="size-4" aria-hidden="true" />
                    </Button>
                    {/* 关注入口只在不是本人主页时出现：本人主页没有可关注的对象 */}
                    {isSelf ? null : <UserFollowAction user={user} remark={remark} onRemarkSaved={onRemarkSaved} />}
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">{describeCounts(user)}</p>
                {user.description.length === 0 ? null : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{user.description}</p>
                )}
            </CardContent>
        </Card>
    )
}

export interface PageUserBlogProps {
    /** 主页控制器：资料、帖子与翻页动作都由页面层持有 */
    feed: WeiboUserBlogController
    credential: WeiboCredentialState | null
    credentialErrorCode: string | null
    credentialErrorMessage: string | null
    /** 当前登录账号 uid：原样透传，评论区据此只给自己的评论显示删除 */
    viewerUid: string | null
    /** 返回上一屏：清空主页目标，回到原视图 */
    onBack: () => void
    onBlockAuthor: (authorName: string) => void
    onRefresh: () => void
    onOpenSettings: () => void
}

export function PageUserBlog({
    feed,
    credential,
    credentialErrorCode,
    credentialErrorMessage,
    viewerUid,
    onBack,
    onBlockAuthor,
    onRefresh,
    onOpenSettings,
}: PageUserBlogProps): JSX.Element {
    const user = feed.state.user
    const { refresh: refreshFeed } = feed
    /** 备注草稿：null 表示跟随资料里的备注，保存后写入，列表与页头按钮共用这一份 */
    const [remarkDraft, setRemarkDraft] = useState<string | null>(null)
    const remark = remarkDraft ?? user?.remark ?? ''
    /** 展示名：有备注用备注，否则用上游昵称 */
    const displayName = remark.length > 0 ? remark : (user?.name ?? '')

    const handleRemarkSaved = useCallback(
        (next: string): void => {
            setRemarkDraft(next)
            // 备注改了就重拉一页：列表里的作者名虽然由本层替换，但评论与计数仍要用最新数据
            void refreshFeed()
        },
        [refreshFeed],
    )

    /**
     * 展示用控制器：把该用户作为作者的名字换成备注名。
     * 关键约束：只换展示，不改 feed 内部状态——刷新后上游仍回真名，覆盖逻辑保持一致；
     * 主贴作者与被转发体作者都按 uid 匹配，其他用户的条目原样返回。
     */
    const displayFeed = useMemo<WeiboUserBlogController>(() => {
        if (user === null || remark.length === 0) {
            return feed
        }
        const posts = feed.state.posts.map((post) => {
            const isMainAuthor = post.author.id === user.id
            const isRetweetAuthor = post.retweeted !== null && post.retweeted.authorId === user.id
            if (!isMainAuthor && !isRetweetAuthor) {
                return post
            }
            return {
                ...post,
                author: isMainAuthor ? { ...post.author, name: remark } : post.author,
                retweeted:
                    isRetweetAuthor && post.retweeted !== null
                        ? { ...post.retweeted, authorName: remark }
                        : post.retweeted,
            }
        })
        return { ...feed, state: { ...feed.state, posts } }
    }, [feed, remark, user])

    /** 是否本人主页：当前账号 uid 与资料 uid 相同即视为本人，uid 未取到时不猜 */
    const isSelf = user !== null && viewerUid !== null && viewerUid === user.id

    const emptyTitle =
        user === null ? '这个主页还没有微博' : `「${displayName.length > 0 ? displayName : '该用户'}」还没有微博`

    return (
        <div className="flex flex-col gap-3">
            {/* 资料与首屏微博同一次请求返回：资料未到货（含未加载完、读取失败）时整块页头不渲染，
                只在列表区给加载态或错误，不拿占位文案撑一个空卡片 */}
            {user === null ? null : (
                <UserProfileCard
                    user={user}
                    remark={remark}
                    isSelf={isSelf}
                    onBack={onBack}
                    onRemarkSaved={handleRemarkSaved}
                />
            )}
            <WeiboFeedSection
                feed={displayFeed}
                credential={credential}
                credentialErrorCode={credentialErrorCode}
                credentialErrorMessage={credentialErrorMessage}
                emptyTitle={emptyTitle}
                emptyDescription="该用户近期没有发布微博，稍后刷新一次再试。"
                onBlockAuthor={onBlockAuthor}
                viewerUid={viewerUid}
                hideFollow
                onRefresh={onRefresh}
                onOpenSettings={onOpenSettings}
            />
        </div>
    )
}
