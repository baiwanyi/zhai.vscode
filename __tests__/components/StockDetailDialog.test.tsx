// @vitest-environment jsdom
/**
 * 在线图库详情弹窗用例：尺寸档位逐档插入、默认插入不带档位、已下载条目不再列档位。
 * 复用约定：渲染查询走 @testing-library/react，点击用 user-event，弹窗为受控组件、直接以 photo 打开。
 * 关键约束：插入与复制一律只回调页面，用例断言的是回调参数而非宿主请求；
 * 档位按钮是纯图标按钮，可访问名由 aria-label 承担，渲染须自带 TooltipProvider 与 ResizeObserver 桩；
 * 已下载的图在本地只有一份，档位列表必须缺席，只保留默认插入入口。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { StockPhotoSizeKey } from '@shared/types/stock'
import { StockDetailDialog } from '@webview/workflow/media/layout/StockDetailDialog'
import type { StockDetailPhoto } from '@webview/workflow/media/layout/StockDetailDialog'

/** jsdom 没有 ResizeObserver：档位按钮带 tooltip，缺了就整棵树渲染失败 */
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

const PHOTO: StockDetailPhoto = {
    id: 'Kq2WnB6x9eA',
    url: 'https://example.test/thumb.jpg',
    alt: '山间薄雾',
    photographer: '张三',
    width: 4000,
    height: 3000,
    sizes: [
        { key: 'raw', label: '原始', width: 4000, height: 3000 },
        { key: 'regular', label: '中图', width: 1080, height: 810 },
    ],
    downloaded: false,
}

interface RenderHandlers {
    onInsert?: (photo: StockDetailPhoto, size?: StockPhotoSizeKey) => void
    onCopy?: (id: string) => void
}

/** 弹窗依赖挂载器的 TooltipProvider，单独渲染时自行包裹 */
function renderDialog(photo: StockDetailPhoto | null, handlers: RenderHandlers = {}): void {
    render(
        <TooltipProvider>
            <StockDetailDialog
                photo={photo}
                onOpenChange={vi.fn()}
                onInsert={handlers.onInsert ?? vi.fn()}
                onCopy={handlers.onCopy ?? vi.fn()}
            />
        </TooltipProvider>,
    )
}

describe('StockDetailDialog', () => {
    it('列出上游档位并逐档插入，点击哪一档就回传哪一档', async () => {
        const user = userEvent.setup()
        const onInsert = vi.fn()
        renderDialog(PHOTO, { onInsert })

        expect(screen.getByText('原始')).toBeDefined()
        expect(screen.getByText('4000×3000')).toBeDefined()

        const insertButtons = screen.getAllByRole('button', { name: '插入到内容' })
        expect(insertButtons).toHaveLength(2)
        await user.click(insertButtons[1] as HTMLElement)

        expect(onInsert).toHaveBeenCalledWith(PHOTO, 'regular')
    })

    it('默认插入不带档位，由宿主按配置宽度取默认尺寸', async () => {
        const user = userEvent.setup()
        const onInsert = vi.fn()
        renderDialog(PHOTO, { onInsert })

        await user.click(screen.getByRole('button', { name: '按默认尺寸插入' }))

        expect(onInsert).toHaveBeenCalledWith(PHOTO)
    })

    it('已下载的图不再列档位，提示插入会复用本地文件', () => {
        renderDialog({ ...PHOTO, sizes: [], downloaded: true })

        expect(screen.getByText('这张图已在本地库中，插入会复用本地文件')).toBeDefined()
        expect(screen.queryByRole('button', { name: '插入到内容' })).toBeNull()
    })

    it('复制按钮回传图片标识', async () => {
        const user = userEvent.setup()
        const onCopy = vi.fn()
        renderDialog(PHOTO, { onCopy })

        await user.click(screen.getByRole('button', { name: '复制图片' }))

        expect(onCopy).toHaveBeenCalledWith(PHOTO.id)
    })
})
