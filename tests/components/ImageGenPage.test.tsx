// @vitest-environment jsdom
/**
 * ImageGenPage 交互用例：覆盖加载与空态、类别/封面/关键词筛选、清空筛选、多选与批量删除。
 * 复用约定：列表、参数与详情三个 hook 以替身接管，断言落在「页面怎么算、怎么调用」上；
 * Sheet 与 ConfirmDialog 用轻量替身，避免把 radix 的 portal 行为混进业务断言。
 * 关键约束：关键词只比对角色名与图片文件名；选中集合与筛选签名绑定；
 * 全选只覆盖已渲染的图片——这三条是筛选/多选逻辑最易回退的地方。
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageLibraryResult, PressImageItem } from '@shared/types/imagegen'
import { ImageGenPage } from '@webview/workflow/imagegen/ImageGenPage'
import type { JSX, ReactNode } from 'react'

const { requestMock, libraryMock, settingsMock, detailMock } = vi.hoisted(() => ({
    requestMock: vi.fn(),
    libraryMock: vi.fn(),
    settingsMock: vi.fn(),
    detailMock: vi.fn(),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@webview/workflow/imagegen/useImageLibrary', () => ({ useImageLibrary: libraryMock }))
vi.mock('@webview/workflow/imagegen/useImageSettings', () => ({ useImageSettings: settingsMock }))
vi.mock('@webview/workflow/imagegen/useImageDetail', () => ({ useImageDetail: detailMock }))

/** 输入卡片在本用例中不参与交互，替身只占位，避免把出图编排混进页面断言 */
vi.mock('@webview/workflow/imagegen/ImageComposer', () => {
    const ImageComposer = (): JSX.Element => <div data-testid="composer" />
    return { ImageComposer }
})

vi.mock('@webview/components/Image', () => {
    const Image = ({ alt }: { alt: string }): JSX.Element => <img alt={alt} />
    return { Image }
})

/** 抽屉替身：只要 open 为真就渲染子节点，不引入 radix 的 portal 与焦点管理 */
vi.mock('@components/ui/sheet', () => {
    interface SlotProps {
        children: ReactNode
    }

    const Sheet = ({ open, children }: { open: boolean; children: ReactNode }): JSX.Element | null =>
        open ? (
            <div role="dialog" aria-label="图片详情">
                {children}
            </div>
        ) : null
    const SheetContent = ({ children }: SlotProps): JSX.Element => <div>{children}</div>
    const SheetHeader = ({ children }: SlotProps): JSX.Element => <div>{children}</div>
    const SheetTitle = ({ children }: SlotProps): JSX.Element => <h2>{children}</h2>
    const SheetDescription = ({ children }: SlotProps): JSX.Element => <p>{children}</p>
    const SheetFooter = ({ children }: SlotProps): JSX.Element => <div>{children}</div>

    return { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter }
})

/** 确认弹窗替身：保留标题与确认按钮语义，跳过 alert-dialog 的动画与遮罩 */
vi.mock('@webview/components/ConfirmDialog', () => {
    interface ConfirmDialogStubProps {
        open: boolean
        title: string
        confirmLabel: string
        onConfirm: () => void
    }

    const ConfirmDialog = ({ open, title, confirmLabel, onConfirm }: ConfirmDialogStubProps): JSX.Element | null =>
        open ? (
            <div role="dialog" aria-label={title}>
                <button type="button" onClick={onConfirm}>
                    {confirmLabel}
                </button>
            </div>
        ) : null

    return { ConfirmDialog }
})

const DIR_PATH = 'press/剑来'
const CHARACTER = { id: 'char-1', name: '林清', coverPortraitId: 'portrait-20261025143000-10428736' }

const PORTRAIT: PressImageItem = {
    id: 'portrait-20261025143000-10428736',
    kind: 'portrait',
    path: 'press/剑来/Images/portrait-20261025143000-10428736.png',
    url: 'https://example.test/portrait.png',
    createdAt: '2026-10-25T14:30:00.000Z',
    characterId: CHARACTER.id,
}
const PHOTO: PressImageItem = {
    id: 'photo-20261025143000-aB3xK9Qz',
    kind: 'photo',
    path: 'press/剑来/Images/photo-20261025143000-aB3xK9Qz.png',
    url: 'https://example.test/photo.png',
    createdAt: '2026-10-25T14:30:01.000Z',
    characterId: null,
}
const LIBRARY: ImageLibraryResult = {
    images: [PORTRAIT, PHOTO],
    coverSelectedId: PHOTO.id,
    counts: { portrait: 1, photo: 1, orphan: 0 },
}

interface LibraryOverrides {
    images?: PressImageItem[]
    coverSelectedId?: string | null
    counts?: ImageLibraryResult['counts']
    isLoading?: boolean
}

const removeImageMock = vi.fn()
const removeImagesMock = vi.fn()
const reloadMock = vi.fn()

function setLibrary(overrides: LibraryOverrides = {}): void {
    libraryMock.mockReturnValue({
        images: overrides.images ?? LIBRARY.images,
        coverSelectedId: overrides.coverSelectedId === undefined ? LIBRARY.coverSelectedId : overrides.coverSelectedId,
        counts: overrides.counts ?? LIBRARY.counts,
        isLoading: overrides.isLoading ?? false,
        removeImage: removeImageMock,
        removeImages: removeImagesMock,
        reload: reloadMock,
    })
}

function renderPage(onChangeCharacter = vi.fn()): typeof onChangeCharacter {
    render(
        <ImageGenPage
            dirPath={DIR_PATH}
            characters={[CHARACTER]}
            setting={{ title: '剑来' }}
            onChangeCharacter={onChangeCharacter}
        />,
    )
    return onChangeCharacter
}

/** 筛选按钮的可访问名末尾带分项计数（如「角色图 1」），按前缀匹配 */
function filterButton(label: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(`^${label}`) })
}

beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({ copied: true, inserted: true, ok: true })
    libraryMock.mockReset()
    settingsMock.mockReset()
    detailMock.mockReset()
    removeImageMock.mockReset()
    removeImagesMock.mockReset()
    reloadMock.mockReset()

    settingsMock.mockReturnValue({
        settings: { defaultRatio: '3:4', portraitStyle: 'auto', coverStyle: 'photo' },
        isLoaded: true,
        save: vi.fn(),
    })
    detailMock.mockReturnValue({ detail: null, isLoading: false })
    setLibrary()
})

afterEach(cleanup)

describe('ImageGenPage', () => {
    it('加载中只显示读取提示，不提前显示空态', () => {
        setLibrary({ images: [], isLoading: true })

        renderPage()

        expect(screen.getByText('正在读取图片')).toBeDefined()
        expect(screen.queryByText('还没有图片')).toBeNull()
    })

    it('无图时显示空态引导', () => {
        setLibrary({ images: [], coverSelectedId: null, counts: { portrait: 0, photo: 0, orphan: 0 } })

        renderPage()

        expect(screen.getByText('还没有图片')).toBeDefined()
    })

    it('按类别筛选只保留对应类型', async () => {
        const user = userEvent.setup()
        renderPage()

        await user.click(filterButton('角色图'))

        expect(screen.getByLabelText('查看详情：林清')).toBeDefined()
        expect(screen.queryByLabelText(`查看详情：${PHOTO.id}`)).toBeNull()
    })

    it('作品封面是筛选维度，只保留封面指向的那张', async () => {
        const user = userEvent.setup()
        renderPage()

        await user.click(filterButton('作品封面'))

        expect(screen.getByLabelText(`查看详情：${PHOTO.id}`)).toBeDefined()
        expect(screen.getAllByText('封面')).toHaveLength(1)
        expect(screen.queryByLabelText('查看详情：林清')).toBeNull()
    })

    it('关键词匹配角色名与文件名，未命中时给出无结果空态', async () => {
        const user = userEvent.setup()
        renderPage()

        await user.type(screen.getByPlaceholderText('搜索角色或文件名'), '林清')
        expect(screen.getByLabelText('查看详情：林清')).toBeDefined()
        expect(screen.queryByLabelText(`查看详情：${PHOTO.id}`)).toBeNull()

        await user.clear(screen.getByPlaceholderText('搜索角色或文件名'))
        await user.type(screen.getByPlaceholderText('搜索角色或文件名'), 'aB3xK9Qz')
        expect(screen.getByLabelText(`查看详情：${PHOTO.id}`)).toBeDefined()

        await user.clear(screen.getByPlaceholderText('搜索角色或文件名'))
        await user.type(screen.getByPlaceholderText('搜索角色或文件名'), '不存在的词')
        expect(screen.getByText('没有符合条件的图片')).toBeDefined()
    })

    it('有筛选时出现清空筛选，点击后恢复到全部', async () => {
        const user = userEvent.setup()
        renderPage()

        expect(screen.queryByRole('button', { name: '清空筛选' })).toBeNull()
        await user.click(filterButton('角色图'))
        await user.click(screen.getByRole('button', { name: '清空筛选' }))

        expect(screen.getByLabelText('查看详情：林清')).toBeDefined()
        expect(screen.getByLabelText(`查看详情：${PHOTO.id}`)).toBeDefined()
    })

    it('多选勾选计数随点击变化，换筛选后清空', async () => {
        const user = userEvent.setup()
        renderPage()

        await user.click(screen.getByRole('button', { name: '选择' }))
        await user.click(screen.getByLabelText(`选择：${PHOTO.id}`))
        expect(screen.getByText('已选 1 张')).toBeDefined()

        await user.click(screen.getByLabelText(`选择：${CHARACTER.name}`))
        expect(screen.getByText('已选 2 张')).toBeDefined()

        // 选中集合与筛选签名绑定：换类别后派生为空集
        await user.click(filterButton('角色图'))
        expect(screen.getByText('已选 0 张')).toBeDefined()
    })

    it('全选只覆盖已渲染的图片', async () => {
        const user = userEvent.setup()
        const many: PressImageItem[] = Array.from({ length: 61 }, (_, index) => ({
            ...PHOTO,
            id: `photo-2026102514${String(index).padStart(4, '0')}-r${index}`,
            path: `press/剑来/Images/photo-${index}.png`,
        }))
        setLibrary({ images: many, coverSelectedId: null, counts: { portrait: 0, photo: 61, orphan: 0 } })
        renderPage()

        await user.click(screen.getByRole('button', { name: '选择' }))
        await user.click(screen.getByRole('button', { name: '全选已显示' }))

        expect(screen.getByText('已选 60 张')).toBeDefined()
        expect(screen.getByRole('button', { name: '加载更多（60 / 61）' })).toBeDefined()
    })

    it('详情面板打开后可设封面，设完重新列举', async () => {
        const user = userEvent.setup()
        renderPage()

        await user.click(screen.getByLabelText(`查看详情：${PHOTO.id}`))
        const panel = screen.getByRole('dialog', { name: '图片详情' })
        // 已是当前封面时按钮禁用
        expect(within(panel).getByRole('button', { name: '已是作品封面' }).hasAttribute('disabled')).toBe(true)

        await user.click(screen.getByLabelText('查看详情：林清'))
        const nextPanel = screen.getByRole('dialog', { name: '图片详情' })
        await user.click(within(nextPanel).getByRole('button', { name: '设为作品封面' }))

        expect(requestMock).toHaveBeenCalledWith('pressAi/setImageCover', { dirPath: DIR_PATH, path: PORTRAIT.path })
        expect(reloadMock).toHaveBeenCalled()
    })

    it('批量删除走一次协议并按剩余列表回退角色封面', async () => {
        const user = userEvent.setup()
        const onChangeCharacter = vi.fn()
        removeImagesMock.mockResolvedValue({ removals: [{ image: PORTRAIT, removed: true }], images: [] })
        renderPage(onChangeCharacter)

        await user.click(screen.getByRole('button', { name: '选择' }))
        await user.click(screen.getByLabelText(`选择：${CHARACTER.name}`))
        await user.click(screen.getByRole('button', { name: '删除选中' }))

        const dialog = screen.getByRole('dialog', { name: '删除选中的 1 张图片？' })
        await user.click(within(dialog).getByRole('button', { name: '删除选中' }))

        expect(removeImagesMock).toHaveBeenCalledWith([PORTRAIT])
        // 被删的正是该角色封面：回退值为剩余列表里该角色最新一张（此处没有剩余，置空）
        expect(onChangeCharacter).toHaveBeenCalledWith(CHARACTER.id, { coverPortraitId: null })
    })
})
