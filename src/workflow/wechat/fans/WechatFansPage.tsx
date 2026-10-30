/**
 * 用户管理页：关注者列表与标签两段。
 * 复用约定：数据取 hooks/useWechatFans，外壳取 AppPage，分段切换取 SegmentedRail，头像用封装 Image；
 * 时间展示走 shared/utils/format 的相对时间，与账号列表口径一致。
 * 关键约束：平台单页最多 1 万 openid、批量资料一次 100 个，故界面只展示首屏 100 位，
 * 并用平台 total 明确告知总数——不承诺「全部加载」，避免用户误以为粉丝只有 100 个；
 * 标签段单独失败时只在该段提示，不影响粉丝列表。
 */
import { Users } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatAccountSummary, WechatFanSummary, WechatFanTag } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { JSX } from 'react'
import { useWechatFans } from '../hooks/useWechatFans'

/** 两个分段：粉丝与标签 */
type FansTab = 'fans' | 'tags'

const TAB_OPTIONS: readonly { value: FansTab; label: string }[] = [
    { value: 'fans', label: '粉丝' },
    { value: 'tags', label: '标签' },
]

/** 收窄分段值 */
function readTab(value: string): FansTab {
    return value === 'tags' ? 'tags' : 'fans'
}

/** 头像缺省时的首字占位 */
function readInitial(fan: WechatFanSummary): string {
    const [first] = Array.from(fan.nickname.length > 0 ? fan.nickname : fan.openid)
    return first ?? '粉'
}

interface WechatFansPageProps {
    account: WechatAccountSummary
}

export function WechatFansPage({ account }: WechatFansPageProps): JSX.Element {
    const { fans, tags, total, status, error, tagsError, reload } = useWechatFans(account.id)
    const [tab, setTab] = useState<FansTab>('fans')

    const renderFans = (): JSX.Element => {
        if (fans.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <Users className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>还没有关注者</EmptyTitle>
                        <EmptyDescription>账号有粉丝关注后，这里会显示最近关注的 100 位。</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-2">
                {fans.map((fan) => (
                    <Item key={fan.openid} variant="outline" className="flex-nowrap">
                        <ItemMedia variant="image">
                            {fan.avatar === undefined ? (
                                <div className="flex size-full items-center justify-center bg-muted text-xs">
                                    {readInitial(fan)}
                                </div>
                            ) : (
                                <Image src={fan.avatar} alt={fan.nickname} />
                            )}
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                            <ItemTitle className="w-full">
                                <span className="block min-w-0 flex-1 truncate">{fan.nickname}</span>
                            </ItemTitle>
                            <ItemDescription className="truncate text-xs">
                                {fan.subscribeStatus === 0
                                    ? '已取关'
                                    : fan.subscribedAt === undefined
                                      ? '关注时间未知'
                                      : `关注于 ${formatRelativeTime(fan.subscribedAt)}`}
                            </ItemDescription>
                        </ItemContent>
                        {fan.subscribeStatus === 0 && (
                            <ItemActions className="shrink-0">
                                <Badge variant="outline">已取关</Badge>
                            </ItemActions>
                        )}
                    </Item>
                ))}
            </div>
        )
    }

    const renderTags = (): JSX.Element => {
        if (tagsError !== null) {
            return (
                <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-sm">标签读取失败</p>
                    <p className="text-xs text-muted-foreground">{tagsError}</p>
                </div>
            )
        }
        if (tags.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>还没有标签</EmptyTitle>
                        <EmptyDescription>标签需要在公众号后台创建，这里只读展示标签与人数。</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-2">
                {tags.map((tag: WechatFanTag) => (
                    <Item key={tag.id} variant="outline" className="flex-nowrap">
                        <ItemContent className="min-w-0">
                            <ItemTitle className="w-full">
                                <span className="block min-w-0 flex-1 truncate">{tag.name}</span>
                            </ItemTitle>
                            <ItemDescription className="text-xs">{`标签 ID ${String(tag.id)}`}</ItemDescription>
                        </ItemContent>
                        <ItemActions className="shrink-0">
                            <Badge variant="secondary">{`${String(tag.count)} 人`}</Badge>
                        </ItemActions>
                    </Item>
                ))}
            </div>
        )
    }

    const renderBody = (): JSX.Element => {
        if (status === 'loading') {
            return (
                <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                </div>
            )
        }
        if (status === 'error') {
            return (
                <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-sm">粉丝列表读取失败</p>
                    <p className="text-xs text-muted-foreground">{error ?? '请稍后重试'}</p>
                    <Button variant="outline" onClick={() => void reload()}>
                        重试
                    </Button>
                </div>
            )
        }
        return tab === 'fans' ? renderFans() : renderTags()
    }

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>用户管理</AppTitle>
                <AppDescription>
                    {tab === 'fans' && total > fans.length
                        ? `${account.name} · 共 ${String(total)} 位，显示前 ${String(fans.length)} 位`
                        : `${account.name} · ${String(total)} 位关注者`}
                </AppDescription>
                <AppMenu>
                    <SegmentedRail
                        items={TAB_OPTIONS}
                        value={tab}
                        onChange={(value) => setTab(readTab(value))}
                        ariaLabel="用户管理分段"
                        variant="outline"
                        size="sm"
                    />
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>{renderBody()}</AppContent>
            <AppFooter>
                <Button variant="outline" onClick={() => void reload()}>
                    刷新
                </Button>
            </AppFooter>
        </AppPage>
    )
}
