// @vitest-environment jsdom
/**
 * WeiboFeedList 用例：覆盖滚动到底自动翻页的触发、单飞守卫、10 次上限与失败降级。
 * 复用约定：jsdom + @testing-library/react；IntersectionObserver 以可手动触发的替身接管，
 * 卡片以轻量替身渲染，断言只落在「onLoadMore 调用次数与底部呈现」上。
 * 关键约束：自动额度用完（10 次）或有取数错误时必须改出「加载更多」按钮并停止自动，
 * 到底时不再出按钮；同一轮加载未结束前重复回调不得连发请求。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeiboTimelineMedia, WeiboTimelinePost } from '@shared/types/weibo'
import { WeiboFeedList } from '@webview/weibo/layout/WeiboFeedList'
import type { JSX } from 'react'
import type { Mock } from 'vitest'

vi.mock('@webview/weibo/layout/WeiboPostCard', () => {
    /** 卡片替身：只回显 id，用例不关心卡片内部渲染 */
    const PostCard = ({ post }: { post: WeiboTimelinePost }): JSX.Element => <div>{post.id}</div>
    return { WeiboPostCard: PostCard }
})

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
}

/** 可手动触发的 IntersectionObserver 替身：记录最近一次实例，供用例模拟进入视口 */
class FakeIntersectionObserver implements IntersectionObserver {
    public static latest: FakeIntersectionObserver | null = null
    public static readonly instances: FakeIntersectionObserver[] = []
    public readonly root: Element | null = null
    public readonly rootMargin = '240px'
    public readonly scrollMargin = '0px'
    public readonly thresholds: ReadonlyArray<number> = [0]
    private readonly handler: IntersectionObserverCallback
    public constructor(handler: IntersectionObserverCallback) {
        this.handler = handler
        FakeIntersectionObserver.latest = this
        FakeIntersectionObserver.instances.push(this)
    }

    public observe(): void {
        // 替身不需要真实监听：进入视口由 trigger 手动驱动
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public takeRecords(): IntersectionObserverEntry[] {
        return []
    }

    /** 触发一次进入视口的回调 */
    public trigger(): void {
        const target = document.body
        const rect = target.getBoundingClientRect()
        this.handler(
            [
                {
                    boundingClientRect: rect,
                    intersectionRatio: 1,
                    intersectionRect: rect,
                    isIntersecting: true,
                    rootBounds: null,
                    target,
                    time: Date.now(),
                },
            ],
            this,
        )
    }
}

interface ListProps {
    isLoadingMore?: boolean
    hasMore?: boolean
    errorMessage?: string | null
    posts?: WeiboTimelinePost[]
}

interface RenderListResult {
    onLoadMore: Mock
    /** 按新状态重渲染：模拟「加载中 → 加载完成」的往返 */
    rerender: (next?: ListProps) => void
}

/** 渲染一份最小列表，返回 onLoadMore 替身与 rerender 入口 */
function renderList(overrides: ListProps = {}): RenderListResult {
    const onLoadMore = vi.fn()
    const initial = {
        posts: [POST],
        isLoading: false,
        isLoadingMore: false,
        hasMore: true,
        onLoadMore,
        ...overrides,
    }
    const view = render(<WeiboFeedList {...initial} />)
    const rerender = (next: ListProps = {}): void => {
        view.rerender(<WeiboFeedList {...initial} {...next} />)
    }
    return { onLoadMore, rerender }
}

/** 模拟一轮自动翻页：进入视口 → 加载中 → 加载完成（重建观察器） */
function autoLoadOnce(rerender: (next?: ListProps) => void): void {
    const observer = FakeIntersectionObserver.latest
    if (observer === null) {
        throw new Error('观察器未创建')
    }
    act(() => {
        observer.trigger()
    })
    act(() => {
        rerender({ isLoadingMore: true })
    })
    act(() => {
        rerender({ isLoadingMore: false })
    })
}

beforeEach(() => {
    FakeIntersectionObserver.latest = null
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
    cleanup()
})

describe('WeiboFeedList 自动翻页', () => {
    it('哨兵进入视口即请求下一页，同一轮内不重复触发', () => {
        const { onLoadMore } = renderList()
        const observer = FakeIntersectionObserver.latest
        if (observer === null) {
            throw new Error('观察器未创建')
        }
        act(() => {
            observer.trigger()
            observer.trigger()
        })
        expect(onLoadMore).toHaveBeenCalledTimes(1)
    })

    it('自动加载 10 次后改出「加载更多」按钮', () => {
        const { onLoadMore, rerender } = renderList()
        for (let index = 0; index < 10; index++) {
            autoLoadOnce(rerender)
        }
        expect(onLoadMore).toHaveBeenCalledTimes(10)
        expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy()
    })

    it('取数错误时直接出按钮，不再自动请求', () => {
        const { onLoadMore } = renderList({ errorMessage: '网络不可用' })
        act(() => {
            FakeIntersectionObserver.latest?.trigger()
        })
        expect(onLoadMore).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy()
    })

    it('到底后显示已到底文案，不出按钮也不自动请求', () => {
        const { onLoadMore } = renderList({ hasMore: false })
        act(() => {
            FakeIntersectionObserver.latest?.trigger()
        })
        expect(onLoadMore).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
        expect(screen.getByText('已经到底了')).toBeTruthy()
    })
})
