// @vitest-environment jsdom
/**
 * ImageGenGrid 交互用例：覆盖缩略图与出处角标、引用徽标、卡片主动作、悬停操作回调与键盘可达性。
 * 复用约定：渲染查询走 @testing-library/react，点击与键盘用 user-event；
 * jsdom 环境由首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：卡片是 div + tabIndex 而不是 button，点击不会自动获得焦点，键盘用例须显式 focus；
 * 内部操作按钮必须 stopPropagation，否则一次点击会同时打开详情——这是本轮最易回归的点。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@shared/types/media'
import { ImageGenGrid } from '@webview/workflow/imagegen/layout/ImageGenGrid'
import type { RenderResult } from '@testing-library/react'

afterEach(cleanup)

const CHARACTER_ID = '10428736'
const CHARACTER_NAME = '林清'

/** 媒体条目工厂：只覆盖断言用到的字段，其余按普通图片补齐 */
function createMedia(overrides: Partial<MediaItem>): MediaItem {
    return {
        id: '20261025143000aB3xK9',
        path: 'images/202610/20261025143000aB3xK9.png',
        url: 'https://example.test/media.png',
        ext: 'png',
        byteSize: 1024,
        month: '2026-10',
        createdAt: '2026-10-25T14:30:00.000Z',
        scope: 'press',
        origin: 'generate',
        kind: 'portrait',
        pressPath: 'press/剑来',
        pressName: '剑来',
        characterId: CHARACTER_ID,
        characterName: CHARACTER_NAME,
        loreKind: null,
        loreId: null,
        loreName: null,
        usageCount: 0,
        missing: false,
        prompt: null,
        ratio: null,
        style: null,
        enhancedFrom: null,
        ...overrides,
    }
}

const PORTRAIT = createMedia({})
const PHOTO = createMedia({
    id: '20261025143001Qm7TzR',
    path: 'images/202610/20261025143001Qm7TzR.png',
    url: 'https://example.test/photo.png',
    kind: 'unknown',
    origin: 'import',
    scope: 'general',
    pressPath: null,
    pressName: null,
    characterId: null,
    characterName: null,
    createdAt: '2026-10-25T14:30:01.000Z',
})

const EMPTY_SELECTION: ReadonlySet<string> = new Set()

interface RenderOptions {
    images?: MediaItem[]
    pendingCount?: number
    isSelecting?: boolean
    selectedIds?: ReadonlySet<string>
    handlers?: {
        onToggleSelect?: (image: MediaItem) => void
        onDelete?: (image: MediaItem) => void
        onCopy?: (image: MediaItem) => void
        onInsert?: (image: MediaItem) => void
        onSelect?: (image: MediaItem) => void
    }
}

function renderGrid(options: RenderOptions = {}): RenderResult {
    const handlers = options.handlers ?? {}
    return render(
        <ImageGenGrid
            images={options.images ?? [PORTRAIT, PHOTO]}
            pendingCount={options.pendingCount ?? 0}
            isSelecting={options.isSelecting ?? false}
            selectedIds={options.selectedIds ?? EMPTY_SELECTION}
            onToggleSelect={handlers.onToggleSelect ?? vi.fn()}
            onDelete={handlers.onDelete ?? vi.fn()}
            onCopy={handlers.onCopy ?? vi.fn()}
            onInsert={handlers.onInsert ?? vi.fn()}
            onSelect={handlers.onSelect ?? vi.fn()}
        />,
    )
}

describe('ImageGenGrid', () => {
    it('缩略图按出处命名，角色图显示角色名，无归属的图显示未关联', () => {
        renderGrid()

        expect(screen.getByAltText(`角色 · ${CHARACTER_NAME}`)).toBeDefined()
        expect(screen.getByAltText('未关联')).toBeDefined()
    })

    it('类型标签只展示来历：角色图显示角色，导入图显示未归类', () => {
        renderGrid()

        expect(screen.getByText('角色')).toBeDefined()
        expect(screen.getByText('未归类')).toBeDefined()
    })

    it('引用数大于 0 时显示徽标，避免满屏「0 处使用」', () => {
        renderGrid({ images: [createMedia({ usageCount: 3 }), PHOTO] })

        expect(screen.getByText('被 3 处使用')).toBeDefined()
        expect(screen.queryByText('被 0 处使用')).toBeNull()
    })

    it('文件丢失的条目显示已丢失标签', () => {
        renderGrid({ images: [createMedia({ missing: true })] })

        expect(screen.getByText('已丢失')).toBeDefined()
    })

    it('有在途出图时在网格首位渲染骨架占位，已有图片仍在其后', () => {
        const { container } = renderGrid({ pendingCount: 1 })

        const grid = container.firstElementChild
        const pendingCard = grid?.firstElementChild
        expect(pendingCard?.querySelector('[data-slot="skeleton"]')).not.toBeNull()
        // 占位正中的转圈：说明「在等」，而不是一块不会动的灰
        expect(pendingCard?.querySelector('[data-slot="spinner"]')).not.toBeNull()
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1)
        expect(screen.getByAltText(`角色 · ${CHARACTER_NAME}`)).toBeDefined()
    })

    it('没有在途出图时不渲染骨架占位', () => {
        const { container } = renderGrid()

        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    })

    it('点击卡片回传对应条目以打开详情', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        renderGrid({ handlers: { onSelect } })

        await user.click(screen.getByLabelText('查看详情：未关联'))

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

        await user.click(screen.getByLabelText(`选择：角色 · ${CHARACTER_NAME}`))

        expect(onToggleSelect).toHaveBeenCalledWith(PORTRAIT)
        expect(onSelect).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull()
    })

    it('已选中的卡片带选中描边，回车同样触发卡片动作', async () => {
        const user = userEvent.setup()
        const onToggleSelect = vi.fn()
        renderGrid({
            images: [PORTRAIT],
            handlers: { onToggleSelect },
            isSelecting: true,
            selectedIds: new Set([PORTRAIT.id]),
        })

        const card = screen.getByLabelText(`选择：角色 · ${CHARACTER_NAME}`)
        expect(card.className.includes('ring-2')).toBe(true)
        card.focus()
        await user.keyboard('{Enter}')
        expect(onToggleSelect).toHaveBeenCalledTimes(1)
    })
})
