// @vitest-environment jsdom
/**
 * CoverFigure 渲染用例：覆盖回读骨架、空态与成品图三态，以及 alt 与空态文案的透传。
 * 复用约定：渲染与查询走 @testing-library/react；jsdom 环境由本文件首行指令声明。
 * 关键约束：isLoading 优先于 src——加载中不得出现空态文案，否则读取期间会先闪一次「还没有封面」；
 * 空态文案由调用方给定，本用例守住「组件不写死业务文案」这条。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CoverFigure } from '@webview/components/CoverFigure'

afterEach(cleanup)

describe('CoverFigure', () => {
    it('回读中只渲染骨架，不出现空态文案', () => {
        const { container } = render(
            <CoverFigure src={null} isLoading alt="作品封面" emptyTitle="还没有封面" emptyDescription="去生图页生成" />,
        )

        expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
        expect(screen.queryByText('还没有封面')).toBeNull()
    })

    it('回读结束且没有图片时渲染调用方给定的空态文案', () => {
        render(
            <CoverFigure
                src={null}
                isLoading={false}
                alt="作品封面"
                emptyTitle="还没有封面"
                emptyDescription="去生图页生成"
            />,
        )

        expect(screen.getByText('还没有封面')).toBeDefined()
        expect(screen.getByText('去生图页生成')).toBeDefined()
    })

    it('有图片时按 alt 渲染成品图，不再显示空态', () => {
        render(
            <CoverFigure
                src="https://example.test/cover.png"
                isLoading={false}
                alt="《星月》的封面"
                emptyTitle="还没有封面"
                emptyDescription="去生图页生成"
            />,
        )

        expect(screen.getByAltText('《星月》的封面')).toBeDefined()
        expect(screen.queryByText('还没有封面')).toBeNull()
    })
})
