// @vitest-environment jsdom
/**
 * WeiboItemActionBar 用例：可选项的渲染条件与赞数展示口径。
 * 复用约定：@testing-library/react 的 render + 无障碍查询，按钮语义全部由 aria-label 承载。
 * 关键约束：删除与加入对话仅在传回调时渲染；赞数为 0 或 null 都不显示数字（不把「未知」渲染成「0」）。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@webview/components/Tooltip'
import { WeiboItemActionBar } from '@webview/weibo/block/WeiboItemActionBar'
import type { WeiboItemActionBarLike } from '@webview/weibo/block/WeiboItemActionBar'
import type { ComponentProps } from 'react'

const LIKE: WeiboItemActionBarLike = {
    isLiked: false,
    count: 3,
    isPending: false,
    toggle: vi.fn(),
}

/** 只给必填项：删除文案必填，其余可选项由用例覆盖；按钮的 tooltip 需要 TooltipProvider 包裹 */
function renderBar(overrides: Partial<ComponentProps<typeof WeiboItemActionBar>> = {}): ReturnType<typeof render> {
    return render(
        <TooltipProvider>
            <WeiboItemActionBar
                createdAt="2026-11-20T23:07:10.000Z"
                createdAtRaw="11-20 23:07"
                deleteLabel="删除这条评论"
                {...overrides}
            />
        </TooltipProvider>,
    )
}

describe('WeiboItemActionBar', () => {
    it('没有删除回调时不渲染删除按钮', () => {
        renderBar()
        expect(screen.queryByRole('button', { name: '删除这条评论' })).toBeNull()
    })

    it('有删除回调时渲染删除按钮', () => {
        renderBar({ onDelete: vi.fn() })
        expect(screen.getByRole('button', { name: '删除这条评论' })).toBeTruthy()
    })

    it('加入对话按钮只在传回调时渲染', () => {
        renderBar()
        expect(screen.queryByRole('button', { name: '添加到 AI 对话' })).toBeNull()
        renderBar({ onAddToChat: vi.fn() })
        expect(screen.getAllByRole('button', { name: '添加到 AI 对话' })).toHaveLength(1)
    })

    it('赞数为 0 时不显示数字', () => {
        renderBar({ like: { ...LIKE, count: 0 } })
        expect(screen.queryByText('0')).toBeNull()
    })

    it('赞数为 null 时不显示数字', () => {
        renderBar({ like: { ...LIKE, count: null } })
        expect(screen.queryByText('0')).toBeNull()
        expect(screen.queryByText('1')).toBeNull()
    })

    it('赞数大于 0 时显示数字', () => {
        renderBar({ like: LIKE })
        expect(screen.getByText('3')).toBeTruthy()
    })
})
