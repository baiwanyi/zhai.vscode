// @vitest-environment jsdom
/**
 * 统一图片列表交互用例：覆盖适配器产出的缩略图与角标、在途占位、卡片主动作、悬停操作与键盘可达性。
 * 复用约定：渲染查询走 @testing-library/react，点击与键盘用 user-event；
 * 媒体条目经 toMediaItem 映射，列表以 flat 模式渲染，状态位与续载入参给最小可用值。
 * 关键约束：卡片主动作是原生 button，操作按钮必须 stopPropagation，否则一次点击会同时触发主动作；
 * 关联角标与 bottom-left 操作条同处左下角，操作按钮带 tooltip，渲染须自带 TooltipProvider 与 ResizeObserver 桩；
 * 多选模式下右上徽标与悬停动作一并隐藏，避免与勾选圈重叠。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Copy, Info, TextCursorInput, Trash2 } from 'lucide-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { MediaItem } from '@shared/types/media'
import { ImageList } from '@webview/workflow/media/layout/imageList/ImageList'
import { toMediaItem } from '@webview/workflow/media/layout/imageList/imageListAdapters'
import type {
    ImageListAction,
    ImageListPaging,
    ImageListStates,
} from '@webview/workflow/media/layout/imageList/imageListModel'
import type { RenderResult } from '@testing-library/react'

/** jsdom 没有 ResizeObserver：Radix Tooltip 用它测量锚点，缺了就整棵树渲染失败 */
class ResizeObserverStub implements ResizeObserver {
    public observe(): void {
        return undefined
    }

    public unobserve(): void {
        return undefined
    }

    public disconnect(): void {
        return undefined
    }
}

beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub
})

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
    origin: 'upload',
    scope: 'general',
    pressPath: null,
    pressName: null,
    characterId: null,
    characterName: null,
    createdAt: '2026-10-25T14:30:01.000Z',
})

const EMPTY_SELECTION: ReadonlySet<string> = new Set()
const STATES: ImageListStates = { empty: { title: '还没有图片' } }
const PAGING: ImageListPaging = { mode: 'none' }

interface RenderOptions {
    images?: MediaItem[]
    pendingCount?: number
    isSelecting?: boolean
    selectedIds?: ReadonlySet<string>
    actions?: ImageListAction<MediaItem>[]
    handlers?: {
        onToggleSelect?: (image: MediaItem) => void
        onDelete?: (image: MediaItem) => void
        onCopy?: (image: MediaItem) => void
        onInsert?: (image: MediaItem) => void
        onSelect?: (image: MediaItem) => void
    }
}

/** 默认动作：右侧竖排的复制 / 插入 / 删除，覆盖通用 placements 的既有能力 */
const DEFAULT_ACTIONS = (handlers: RenderOptions['handlers'] = {}): ImageListAction<MediaItem>[] => [
    { key: 'copy', label: '复制图片', icon: Copy, onTrigger: (item) => handlers.onCopy?.(item.source) },
    {
        key: 'insert',
        label: '插入到文章',
        icon: TextCursorInput,
        onTrigger: (item) => handlers.onInsert?.(item.source),
    },
    { key: 'delete', label: '删除图片', icon: Trash2, onTrigger: (item) => handlers.onDelete?.(item.source) },
]

function renderList(options: RenderOptions = {}): RenderResult {
    const handlers = options.handlers ?? {}
    const actions = options.actions ?? DEFAULT_ACTIONS(handlers)
    return render(
        <TooltipProvider>
            <ImageList
                mode="flat"
                items={(options.images ?? [PORTRAIT, PHOTO]).map((image) => toMediaItem(image))}
                aspect="3/4"
                pendingCount={options.pendingCount ?? 0}
                isSelecting={options.isSelecting ?? false}
                selectedIds={options.selectedIds ?? EMPTY_SELECTION}
                states={STATES}
                paging={PAGING}
                actions={actions}
                onActivate={(item) => handlers.onSelect?.(item.source)}
                onToggleSelect={(item) => handlers.onToggleSelect?.(item.source)}
            />
        </TooltipProvider>,
    )
}

describe('ImageList', () => {
    it('缩略图按出处命名，角色图显示角色名，无归属的图显示无出处', () => {
        renderList()

        expect(screen.getByAltText(`角色 · ${CHARACTER_NAME}`)).toBeDefined()
        expect(screen.getByAltText('无出处')).toBeDefined()
    })

    it('类型标签只展示来历：角色图显示角色，导入图显示未归类', () => {
        renderList()

        expect(screen.getByText('角色')).toBeDefined()
        expect(screen.getByText('未归类')).toBeDefined()
    })

    it('关联角标落在左下角且只显示引用条数，避免满屏「关联 0」', () => {
        renderList({ images: [createMedia({ usageCount: 3 }), PHOTO] })

        const usage = screen.getByText('3')
        expect(usage.closest('.absolute')?.className).toContain('bottom-1.5')
        expect(screen.queryByText('0')).toBeNull()
    })

    it('文件丢失的条目显示已丢失标签', () => {
        renderList({ images: [createMedia({ missing: true })] })

        expect(screen.getByText('已丢失')).toBeDefined()
    })

    it('有在途出图时在网格首位渲染骨架占位，已有图片仍在其后', () => {
        const { container } = renderList({ pendingCount: 1 })

        const grid = container.querySelector('[data-slot="item-group"]')
        const pendingCard = grid?.firstElementChild
        expect(pendingCard?.querySelector('[data-slot="skeleton"]')).not.toBeNull()
        expect(pendingCard?.querySelector('[data-slot="spinner"]')).not.toBeNull()
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1)
        expect(screen.getByAltText(`角色 · ${CHARACTER_NAME}`)).toBeDefined()
    })

    it('没有在途出图时不渲染骨架占位', () => {
        const { container } = renderList()

        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    })

    it('点击卡片回传对应条目以执行主动作', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        renderList({ handlers: { onSelect } })

        await user.click(screen.getByLabelText('插入到文章：无出处'))

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith(PHOTO)
    })

    it('悬停动作排在右下角竖列，按钮点击回传领域条目', async () => {
        const user = userEvent.setup()
        const onDetail = vi.fn()
        renderList({
            images: [createMedia({ usageCount: 1 })],
            actions: [
                {
                    key: 'detail',
                    label: '查看详情',
                    icon: Info,
                    onTrigger: (item): void => {
                        onDetail(item.source)
                    },
                },
            ],
        })

        const button = screen.getByRole('button', { name: '查看详情' })
        expect(button.parentElement?.className).toContain('right-1.5')
        expect(button.parentElement?.className).toContain('flex-col')
        await user.click(button)
        expect(onDetail).toHaveBeenCalledTimes(1)
    })

    it('复制、插入、删除三个操作按钮各自回传条目', async () => {
        const user = userEvent.setup()
        const onCopy = vi.fn()
        const onInsert = vi.fn()
        const onDelete = vi.fn()
        renderList({ images: [PHOTO], handlers: { onCopy, onInsert, onDelete } })

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
        renderList({ images: [PHOTO], handlers: { onSelect, onCopy } })

        await user.click(screen.getByRole('button', { name: '复制图片' }))

        expect(onCopy).toHaveBeenCalledTimes(1)
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('多选模式点击卡片切换选中，且不打开详情、不显示操作按钮', async () => {
        const user = userEvent.setup()
        const onToggleSelect = vi.fn()
        const onSelect = vi.fn()
        renderList({ handlers: { onToggleSelect, onSelect }, isSelecting: true })

        await user.click(screen.getByLabelText(`选择：角色 · ${CHARACTER_NAME}`))

        expect(onToggleSelect).toHaveBeenCalledWith(PORTRAIT)
        expect(onSelect).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull()
    })

    it('已选中的卡片带选中描边，回车同样触发卡片动作', async () => {
        const user = userEvent.setup()
        const onToggleSelect = vi.fn()
        renderList({
            images: [PORTRAIT],
            handlers: { onToggleSelect },
            isSelecting: true,
            selectedIds: new Set([PORTRAIT.id]),
        })

        const card = screen.getByLabelText(`选择：角色 · ${CHARACTER_NAME}`)
        expect(card.closest('[data-slot="item"]')?.className.includes('ring-2')).toBe(true)
        card.focus()
        await user.keyboard('{Enter}')
        expect(onToggleSelect).toHaveBeenCalledTimes(1)
    })
})
