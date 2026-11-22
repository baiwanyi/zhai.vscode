// @vitest-environment jsdom
/**
 * 主页关注入口用例：页头按钮的两种形态、本人主页不给入口，以及列表卡片不再重复关注入口。
 * 复用约定：jsdom + @testing-library/react；bridge.request 以替身接管，弹窗关闭时不发请求；
 * 卡片头部与主页都接受假数据，只断言关注按钮的出现条件。
 * 关键约束：个人主页的关注由页头统一提供，卡片头部在 hideFollow 时不得渲染关注按钮，
 * 「更多」菜单里的取消关注也不能出现；未关注的页头按钮文案是「关注」；
 * 当前登录账号与主页 uid 相同时（本人主页）不渲染关注入口。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboTimelinePost, WeiboTimelineMedia, WeiboUserInfo } from '@shared/types/weibo'
import { TooltipProvider } from '@webview/components/Tooltip'
import type { WeiboAuthorFollowController } from '@webview/weibo/hooks/useWeiboAuthorFollow'
import type { WeiboUserBlogController } from '@webview/weibo/hooks/useWeiboUserBlog'
import { PageUserBlog } from '@webview/weibo/layout/PageUserBlog'
import { UserFollowAction } from '@webview/weibo/layout/UserFollowAction'
import { WeiboPostCardHeader } from '@webview/weibo/layout/WeiboPostCardHeader'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn(() => Promise.resolve(undefined)) }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({
    toastError: vi.fn(),
    toErrorText: (cause: unknown): string => String(cause),
}))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

/** 空媒体：本文件只关心页头与关注按钮 */
const EMPTY_MEDIA: WeiboTimelineMedia = {
    items: [],
    images: [],
    imageIds: [],
    thumbnails: [],
    sizes: [],
    videoUrl: null,
    imageCount: 0,
    videoCount: 0,
}

const POST: WeiboTimelinePost = {
    id: '5100000000000001',
    mblogid: 'Rsj8O8SqU',
    url: 'https://weibo.com/3793264344/Rsj8O8SqU',
    text: '一条微博',
    segments: [{ type: 'text', text: '一条微博' }],
    createdAt: '2026-11-20T23:07:10.000Z',
    createdAtRaw: '11-20 23:07',
    source: '',
    author: { id: '3793264344', name: '墨嵐_Maura', avatarUrl: '', isVerified: false, isFollowing: false },
    metrics: { reposts: 0, comments: 0, likes: 0 },
    media: EMPTY_MEDIA,
    retweeted: null,
    isLiked: false,
    isLongText: false,
    readsCount: null,
}

/** 主页资料：关注态与备注都可控 */
function createUser(overrides: Partial<WeiboUserInfo> = {}): WeiboUserInfo {
    return {
        id: '6402514052',
        name: '可爱的埋埋',
        avatarUrl: '',
        coverUrl: '',
        isVerified: true,
        description: '',
        location: '江苏',
        gender: 'm',
        followersCount: 1314167,
        friendsCount: 357,
        statusesCount: 3824,
        isFollowing: false,
        remark: '',
        ...overrides,
    }
}

/** 关注控制器假实现：只提供渲染需要的字段 */
function createFollow(overrides: Partial<WeiboAuthorFollowController> = {}): WeiboAuthorFollowController {
    return { isFollowing: false, isFollowPending: false, canFollow: true, toggleFollow: vi.fn(), ...overrides }
}

describe('页头关注按钮', () => {
    it('未关注时渲染「关注」', () => {
        render(
            <TooltipProvider>
                <UserFollowAction user={createUser()} remark="" onRemarkSaved={vi.fn()} />
            </TooltipProvider>,
        )
        expect(screen.getByText('关注')).toBeTruthy()
        expect(requestMock).not.toHaveBeenCalled()
    })

    it('已关注时渲染「已关注」，备注非空则显示备注名', () => {
        render(
            <TooltipProvider>
                <UserFollowAction user={createUser({ isFollowing: true })} remark="埋总" onRemarkSaved={vi.fn()} />
            </TooltipProvider>,
        )
        expect(screen.getByText('埋总')).toBeTruthy()
        expect(screen.queryByText('已关注')).toBeNull()
    })
})

describe('卡片头部的关注入口', () => {
    it('未指定 hideFollow 时渲染关注按钮', () => {
        render(
            <TooltipProvider>
                <WeiboPostCardHeader post={POST} follow={createFollow()} onOpen={vi.fn()} />
            </TooltipProvider>,
        )
        expect(screen.getByLabelText('关注该博主')).toBeTruthy()
    })

    it('hideFollow 时关注按钮与菜单里的取消关注都不渲染', () => {
        render(
            <TooltipProvider>
                <WeiboPostCardHeader
                    post={POST}
                    follow={createFollow({ isFollowing: true })}
                    hideFollow
                    onOpen={vi.fn()}
                />
            </TooltipProvider>,
        )
        expect(screen.queryByLabelText('已关注该博主')).toBeNull()
        expect(screen.queryByText('关注')).toBeNull()
    })
})

describe('卡片头部的阅读数', () => {
    it('本人微博显示阅读数，按万级折算', () => {
        render(
            <TooltipProvider>
                <WeiboPostCardHeader
                    post={{ ...POST, readsCount: 12_345 }}
                    follow={createFollow()}
                    viewerUid={POST.author.id}
                    onOpen={vi.fn()}
                />
            </TooltipProvider>,
        )
        // 胶囊里只有图标与数字，完整口径在悬停提示里（内容不悬停不挂载）
        expect(screen.getByText('1.2万')).toBeTruthy()
    })

    it('别人的微博即使带了阅读数也不显示', () => {
        render(
            <TooltipProvider>
                <WeiboPostCardHeader
                    post={{ ...POST, readsCount: 12_345 }}
                    follow={createFollow()}
                    viewerUid="9999999999"
                    onOpen={vi.fn()}
                />
            </TooltipProvider>,
        )
        expect(screen.queryByText('1.2万')).toBeNull()
    })

    it('本人微博但上游没有阅读数时不显示', () => {
        render(
            <TooltipProvider>
                <WeiboPostCardHeader
                    post={{ ...POST, readsCount: null }}
                    follow={createFollow()}
                    viewerUid={POST.author.id}
                    onOpen={vi.fn()}
                />
            </TooltipProvider>,
        )
        expect(screen.queryByText('1.2万')).toBeNull()
    })
})

/** 主页控制器假实现：空列表即可，本文件只关心页头关注入口；user 为 null 表示资料未到货 */
function createUserBlogFeed(user: WeiboUserInfo | null): WeiboUserBlogController {
    return {
        state: {
            posts: [],
            isLoading: false,
            isLoadingMore: false,
            isRefreshing: false,
            hasLoaded: user !== null,
            errorMessage: null,
            sinceId: null,
            maxId: null,
            hasMore: false,
            user,
            page: 1,
            total: 0,
        },
        refresh: () => Promise.resolve(),
        loadMore: () => Promise.resolve(),
    }
}

/** 渲染个人主页：viewerUid 决定是不是本人 */
function renderUserPage(user: WeiboUserInfo | null, viewerUid: string | null): void {
    render(
        <TooltipProvider>
            <PageUserBlog
                feed={createUserBlogFeed(user)}
                credential={{ isConfigured: true, savedAt: null }}
                credentialErrorCode={null}
                credentialErrorMessage={null}
                viewerUid={viewerUid}
                onBack={vi.fn()}
                onBlockAuthor={vi.fn()}
                onRefresh={vi.fn()}
                onOpenSettings={vi.fn()}
            />
        </TooltipProvider>,
    )
}

describe('资料未到货时的页头', () => {
    it('整块页头不渲染，也不再给占位文案', () => {
        renderUserPage(null, null)
        expect(screen.queryByLabelText('返回')).toBeNull()
        expect(screen.queryByText(/正在读取用户资料/u)).toBeNull()
        expect(screen.queryByText(/还没有配置微博 Cookie/u)).toBeNull()
        expect(screen.queryByText(/用户资料未取到/u)).toBeNull()
    })
})

describe('本人主页的关注入口', () => {
    it('主页 uid 与当前账号相同（本人）时不渲染关注按钮', () => {
        renderUserPage(createUser(), createUser().id)
        expect(screen.queryByText('关注')).toBeNull()
        expect(screen.queryByLabelText(/关注 /u)).toBeNull()
    })

    it('不是本人时仍渲染关注按钮', () => {
        renderUserPage(createUser(), '3793264344')
        expect(screen.getByText('关注')).toBeTruthy()
    })

    it('当前账号 uid 未取到时不隐藏关注按钮', () => {
        renderUserPage(createUser(), null)
        expect(screen.getByText('关注')).toBeTruthy()
    })
})
