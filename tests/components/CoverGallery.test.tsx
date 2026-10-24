// @vitest-environment jsdom
/**
 * CoverGallery 交互用例：覆盖加载骨架、空态、计数、封面徽标与三类卡片操作。
 * 复用约定：渲染与查询走 @testing-library/react，点击与双击用 user-event；
 * jsdom 环境由本文件首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：图库只做展示与回调，删除后的目录回读与封面顺延由调用方 hook 负责，
 * 因此这里只断言回调收到的条目，不模拟磁盘状态变化。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoverGallery } from '@webview/components/CoverGallery'
import type { CoverGalleryItem, CoverGalleryProps } from '@webview/components/CoverGallery'

afterEach(cleanup)

const ITEM_ONE: CoverGalleryItem = {
    id: 'cover-1',
    url: 'https://example.test/1.png',
    path: 'press/书/Cover/cover-1.png',
}
const ITEM_TWO: CoverGalleryItem = {
    id: 'cover-2',
    url: 'https://example.test/2.png',
    path: 'press/书/Cover/cover-2.png',
}
const ITEM_THREE: CoverGalleryItem = {
    id: 'cover-3',
    url: 'https://example.test/3.png',
    path: 'press/书/Cover/cover-3.png',
}
const ITEMS: readonly CoverGalleryItem[] = [ITEM_ONE, ITEM_TWO, ITEM_THREE]

function countLabel(count: number): string {
    return `已生成 ${count} 张`
}

function renderGallery(overrides: Partial<CoverGalleryProps> = {}): ReturnType<typeof render> {
    return render(
        <CoverGallery
            items={ITEMS}
            coverId="cover-1"
            emptyTitle="还没有封面"
            emptyDescription="生成后会自动设为封面"
            altPrefix="封面"
            deleteLabel="删除封面"
            countLabel={countLabel}
            onSetCover={vi.fn()}
            onDelete={vi.fn()}
            {...overrides}
        />,
    )
}

describe('CoverGallery', () => {
    it('加载中只渲染骨架，不提前显示空态', () => {
        const { container } = renderGallery({ items: [], isLoading: true })

        expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
        expect(screen.queryByText('还没有封面')).toBeNull()
    })

    it('无图且未在生成时渲染空态文案', () => {
        renderGallery({ items: [], coverId: null })

        expect(screen.getByText('还没有封面')).toBeDefined()
        expect(screen.getByText('生成后会自动设为封面')).toBeDefined()
    })

    it('渲染图片、张数说明，并为当前封面显示徽标', () => {
        renderGallery()

        expect(screen.getByText('已生成 3 张')).toBeDefined()
        expect(screen.getByAltText('封面 cover-1')).toBeDefined()
        expect(screen.getAllByText('封面')).toHaveLength(1)
        // 非封面项才有「设为封面」，封面项换成徽标
        expect(screen.getAllByRole('button', { name: '设为封面' })).toHaveLength(2)
    })

    it('coverId 为空时不显示封面徽标', () => {
        renderGallery({ coverId: null })

        expect(screen.queryByText('封面')).toBeNull()
        expect(screen.getAllByRole('button', { name: '设为封面' })).toHaveLength(3)
    })

    it('点击设为封面回传对应条目', async () => {
        const user = userEvent.setup()
        const onSetCover = vi.fn()
        renderGallery({ items: [ITEM_ONE, ITEM_TWO], onSetCover })

        await user.click(screen.getByRole('button', { name: '设为封面' }))

        expect(onSetCover).toHaveBeenCalledTimes(1)
        expect(onSetCover).toHaveBeenCalledWith(ITEM_TWO)
    })

    it('点击删除回传对应条目', async () => {
        const user = userEvent.setup()
        const onDelete = vi.fn()
        renderGallery({ items: [ITEM_ONE], coverId: 'cover-1', onDelete })

        await user.click(screen.getByRole('button', { name: '删除封面' }))

        expect(onDelete).toHaveBeenCalledTimes(1)
        expect(onDelete).toHaveBeenCalledWith(ITEM_ONE)
    })

    it('正在删除的那张禁用删除按钮', () => {
        renderGallery({ items: [ITEM_ONE], busyPath: ITEM_ONE.path })

        expect(screen.getByRole('button', { name: '删除封面' }).hasAttribute('disabled')).toBe(true)
    })

    it('传了 onPreview 时双击图片回传条目', async () => {
        const user = userEvent.setup()
        const onPreview = vi.fn()
        renderGallery({ onPreview })

        await user.dblClick(screen.getByAltText('封面 cover-2'))

        expect(onPreview).toHaveBeenCalledWith(ITEM_TWO)
    })

    it('未传 onPreview 时双击不抛错且不触发任何回调', async () => {
        const user = userEvent.setup()
        const onSetCover = vi.fn()
        renderGallery({ onSetCover })

        await user.dblClick(screen.getByAltText('封面 cover-2'))

        expect(onSetCover).not.toHaveBeenCalled()
    })

    it('生成中在首位插入占位，且即使无图也不显示空态', () => {
        renderGallery({ items: [], coverId: null, isGenerating: true })

        expect(screen.getByText('生成中')).toBeDefined()
        expect(screen.queryByText('还没有封面')).toBeNull()
        expect(screen.queryByText('已生成 0 张')).toBeNull()
    })
})
