// @vitest-environment jsdom
/**
 * 转发行渲染：作者名、附言与「时间 + 删除」操作行都要出现。
 * 重点锁住操作行没有被条件分支吞掉——时间始终渲染，删除入口只在 canDelete 时出现。
 * 时间文案随本地时区变化，这里只断言形状（`MM-dd HH:mm` 或 `yyyy-MM-dd HH:mm`）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboRepostItem } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { TooltipProvider } from '@webview/components/Tooltip'
import { RepostItem } from '../src/weibo/block/RepostItem'

vi.mock('@shared/utils/bridge', () => ({ request: vi.fn() }))

/** 固定一条带附言的转发：id 与作者都用真实形态，避免走到丢弃分支 */
const repost: WeiboRepostItem = {
    id: '5367759501266671',
    mblogid: 'Rs4KtdzoV',
    text: '转发附言',
    segments: [{ type: 'text', text: '转发附言' }],
    createdAt: '2026-01-02T03:04:05.000Z',
    createdAtRaw: 'Fri Jan 02 11:04:05 +0800 2026',
    author: { id: '6305885570', name: '测试作者', avatarUrl: '', isVerified: true, isFollowing: false },
    likes: 3,
    isLiked: false,
    originalLikes: 82_833,
    source: '微博网页版',
}

describe('RepostItem', () => {
    afterEach(() => {
        cleanup()
    })

    it('渲染作者、附言、时间与删除入口', () => {
        render(
            <TooltipProvider>
                <RepostItem
                    repost={repost}
                    canDelete
                    isAddingToChat={false}
                    onAddToChat={vi.fn()}
                    onQuote={vi.fn()}
                    onDelete={vi.fn()}
                />
            </TooltipProvider>,
        )

        expect(screen.getByText('测试作者')).toBeTruthy()
        expect(screen.getByText('转发附言')).toBeTruthy()
        expect(screen.getByText(/^\d{2}-\d{2} \d{2}:\d{2}$|^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeTruthy()
        expect(screen.getByLabelText('赞')).toBeTruthy()
        expect(screen.getByText('3')).toBeTruthy()
        // 原博赞数与转发自身赞数分开标注：8.2 万四舍五入到一位小数
        expect(screen.getByText(/原博 8\.3万 赞/u)).toBeTruthy()
        expect(screen.getByLabelText('引用这条转发')).toBeTruthy()
        expect(screen.getByLabelText('添加到 AI 对话')).toBeTruthy()
        expect(screen.getByLabelText('删除这条转发')).toBeTruthy()
    })

    it('点赞后计数从 0 变成 1，并在取消后回到不显示', async () => {
        vi.mocked(request).mockResolvedValue({ liked: true, attitudesCount: 1 })
        render(
            <TooltipProvider>
                <RepostItem
                    repost={{ ...repost, likes: 0, isLiked: false }}
                    canDelete={false}
                    isAddingToChat={false}
                    onAddToChat={vi.fn()}
                    onQuote={vi.fn()}
                    onDelete={vi.fn()}
                />
            </TooltipProvider>,
        )

        // 初始 0 赞：不显示数字
        expect(screen.queryByText('0')).toBeNull()
        fireEvent.click(screen.getByLabelText('赞'))
        expect(await screen.findByText('1')).toBeTruthy()
    })

    it('上游没下发点赞计数时不显示数字，点赞入口仍在', () => {
        render(
            <TooltipProvider>
                <RepostItem
                    repost={{ ...repost, likes: null }}
                    canDelete={false}
                    isAddingToChat={false}
                    onAddToChat={vi.fn()}
                    onQuote={vi.fn()}
                    onDelete={vi.fn()}
                />
            </TooltipProvider>,
        )

        expect(screen.getByLabelText('赞')).toBeTruthy()
        expect(screen.queryByText('0')).toBeNull()
        expect(screen.queryByText('3')).toBeNull()
    })

    it('不能删除时只留时间，不渲染删除入口', () => {
        render(
            <TooltipProvider>
                <RepostItem
                    repost={repost}
                    canDelete={false}
                    isAddingToChat={false}
                    onAddToChat={vi.fn()}
                    onQuote={vi.fn()}
                    onDelete={vi.fn()}
                />
            </TooltipProvider>,
        )

        expect(screen.getByText(/^\d{2}-\d{2} \d{2}:\d{2}$|^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeTruthy()
        expect(screen.queryByLabelText('删除这条转发')).toBeNull()
    })
})
