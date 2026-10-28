// @vitest-environment jsdom
/**
 * ImageGenGrid 交互用例：覆盖缩略图与角标渲染、卡片主动作、悬停操作回调与键盘可达性。
 * 复用约定：渲染查询走 @testing-library/react，点击与键盘用 user-event；
 * jsdom 环境由首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：卡片是 div + tabIndex 而不是 button，点击不会自动获得焦点，键盘用例须显式 focus；
 * 内部操作按钮必须 stopPropagation，否则一次点击会同时打开详情——这是本轮最易回归的点。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PressImageItem } from '@shared/types/imagegen'
import { ImageGenGrid } from '@webview/workflow/imagegen/layout/ImageGenGrid'
import type { RenderResult } from '@testing-library/react'

afterEach(cleanup)

const CHARACTER_ID = 'char-1'
const CHARACTER_NAME = '林清'

const PORTRAIT: PressImageItem = {
    id: 'portrait-20261025143000-10428736',
    kind: 'portrait',
    path: 'press/剑来/Images/portrait-20261025143000-10428736.png',
    url: 'https://example.test/portrait.png',
    createdAt: '2026-10-25T14:30:00.000Z',
    characterId: CHARACTER_ID,
    loreId: null,
    loreKind: null,
}
const PHOTO: PressImageItem = {
    id: 'photo-20261025143000-aB3xK9Qz',
    kind: 'photo',
    path: 'press/剑来/Images/photo-20261025143000-aB3xK9Qz.png',
    url: 'https://example.test/photo.png',
    createdAt: '2026-10-25T14:30:01.000Z',
    characterId: null,
    loreId: null,
    loreKind: null,
}

const CHARACTER_NAMES = new Map([[CHARACTER_ID, CHARACTER_NAME]])
const LORE_NAMES = new Map<string, string>()
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

interface RenderOptions {
    images?: PressImageItem[]
    pendingCount?: number
    coverSelectedId?: string | null
    isSelecting?: boolean
    selectedPaths?: ReadonlySet<string>
    handlers?: {
        onToggleSelect?: (image: PressImageItem) => void
        onDelete?: (image: PressImageItem) => void
        onCopy?: (image: PressImageItem) => void
        onInsert?: (image: PressImageItem) => void
        onSelect?: (image: PressImageItem) => void
    }
}

function renderGrid(options: RenderOptions = {}): RenderResult {
    const handlers = options.handlers ?? {}
    return render(
        <ImageGenGrid
            images={options.images ?? [PORTRAIT, PHOTO]}
            pendingCount={options.pendingCount ?? 0}
            coverSelectedId={options.coverSelectedId ?? null}
            characterNames={CHARACTER_NAMES}
            loreNames={LORE_NAMES}
            isSelecting={options.isSelecting ?? false}
            selectedPaths={options.selectedPaths ?? EMPTY_SELECTION}
            onToggleSelect={handlers.onToggleSelect ?? vi.fn()}
            onDelete={handlers.onDelete ?? vi.fn()}
            onCopy={handlers.onCopy ?? vi.fn()}
            onInsert={handlers.onInsert ?? vi.fn()}
            onSelect={handlers.onSelect ?? vi.fn()}
        />,
    )
}

describe('ImageGenGrid', () => {
    it('缩略图按角色名或图片 id 命名，角色角标只在归属角色时出现', () => {
        renderGrid()

        expect(screen.getByAltText(CHARACTER_NAME)).toBeDefined()
        expect(screen.getByAltText(PHOTO.id)).toBeDefined()
        // 角标是唯一的文本节点，无角色的图没有角标
        expect(screen.getByText(CHARACTER_NAME)).toBeDefined()
        expect(screen.queryByText(PHOTO.id)).toBeNull()
    })

    it('只有封面指向的那张显示封面徽标', () => {
        renderGrid({ coverSelectedId: PORTRAIT.id })

        expect(screen.getAllByText('封面')).toHaveLength(1)
    })

    it('封面指向空时不显示任何徽标', () => {
        renderGrid()

        expect(screen.queryByText('封面')).toBeNull()
    })

    it('有在途出图时在网格首位渲染骨架占位，已有图片仍在其后', () => {
        const { container } = renderGrid({ pendingCount: 1 })

        const grid = container.firstElementChild
        const pendingCard = grid?.firstElementChild
        expect(pendingCard?.querySelector('[data-slot="skeleton"]')).not.toBeNull()
        // 占位正中的转圈：说明「在等」，而不是一块不会动的灰
        expect(pendingCard?.querySelector('[data-slot="spinner"]')).not.toBeNull()
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1)
        expect(screen.getByAltText(CHARACTER_NAME)).toBeDefined()
    })

    it('没有在途出图时不渲染骨架占位', () => {
        const { container } = renderGrid()

        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    })

    it('点击卡片回传对应条目以打开详情', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        renderGrid({ handlers: { onSelect } })

        await user.click(screen.getByLabelText(`查看详情：${PHOTO.id}`))

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith(PHOTO)
    })

    it('复制、插入、删除三个操作按钮各自回传条目', async () => {
        const user = userEvent.setup()
        const onCopy = vi.fn()
        const onInsert = vi.fn()
        const onDelete = vi.fn()
        renderGrid({ images: [PHOTO], handlers: { onCopy, onInsert, onDelete } })

        await user.click(screen.getByRole('button', { name: '复制图片' }))
        await user.click(screen.getByRole('button', { name: '插入到文章' }))
        await user.click(screen.getByRole('button', { name: '删除图片' }))

        expect(onCopy).toHaveBeenCalledWith(PHOTO)
        expect(onInsert).toHaveBeenCalledWith(PHOTO)
        expect(onDelete).toHaveBeenCalledWith(PHOTO)
    })

    it('操作按钮点击不冒泡成打开详情', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        const onCopy = vi.fn()
        renderGrid({ images: [PHOTO], handlers: { onSelect, onCopy } })

        await user.click(screen.getByRole('button', { name: '复制图片' }))

        expect(onCopy).toHaveBeenCalledTimes(1)
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('多选模式点击卡片切换选中，且不打开详情、不显示操作按钮', async () => {
        const user = userEvent.setup()
        const onToggleSelect = vi.fn()
        const onSelect = vi.fn()
        renderGrid({ handlers: { onToggleSelect, onSelect }, isSelecting: true })

        await user.click(screen.getByLabelText(`选择：${CHARACTER_NAME}`))

        expect(onToggleSelect).toHaveBeenCalledWith(PORTRAIT)
        expect(onSelect).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: '删除图片' })).toBeNull()
    })

    it('多选模式下已选卡片带选中描边', () => {
        renderGrid({ isSelecting: true, selectedPaths: new Set([PHOTO.path]) })

        const checked = screen.getByLabelText(`选择：${PHOTO.id}`)
        const unchecked = screen.getByLabelText(`选择：${CHARACTER_NAME}`)

        expect(checked.className).toContain('ring-primary')
        expect(unchecked.className).not.toContain('ring-primary')
    })

    it('焦点在卡片时回车与空格都能激活主动作', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        renderGrid({ images: [PHOTO], handlers: { onSelect } })

        const card = screen.getByLabelText(`查看详情：${PHOTO.id}`)
        card.focus()
        await user.keyboard('{Enter}')
        expect(onSelect).toHaveBeenCalledTimes(1)

        card.focus()
        await user.keyboard(' ')
        expect(onSelect).toHaveBeenCalledTimes(2)
    })

    it('其它按键不激活卡片', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        renderGrid({ images: [PHOTO], handlers: { onSelect } })

        const card = screen.getByLabelText(`查看详情：${PHOTO.id}`)
        card.focus()
        await user.keyboard('a')

        expect(onSelect).not.toHaveBeenCalled()
    })

    it('焦点在操作按钮上回车只触发按钮，不打开详情', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        const onCopy = vi.fn()
        renderGrid({ images: [PHOTO], handlers: { onSelect, onCopy } })

        const copyButton = screen.getByRole('button', { name: '复制图片' })
        copyButton.focus()
        await user.keyboard('{Enter}')

        expect(onCopy).toHaveBeenCalled()
        expect(onSelect).not.toHaveBeenCalled()
    })
})
