// @vitest-environment jsdom
/**
 * 手机预览的添加入口用例：确认不同一级菜单状态下加号按钮都在 DOM 中。
 * 关键约束：加号按钮不能因达到上限或目录形态而静默消失，只能在到限时禁用。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WechatMenuButton } from '../src/shared/types/wechat'
import { TooltipProvider } from '../src/components/Tooltip'
import { MenuPhonePreview } from '../src/workflow/wechat/menu/layout/MenuPhonePreview'

afterEach(cleanup)

const LEAF: WechatMenuButton = {
    id: 'leaf-1',
    name: '菜单',
    type: 'media_id',
    mediaId: 'media-1',
    content: { kind: 'image', materialId: 'm1', mediaId: 'media-1', url: 'https://example.com/1.png' },
}

function renderPreview(buttons: WechatMenuButton[]): void {
    render(
        <TooltipProvider>
            <MenuPhonePreview
                buttons={buttons}
                status="ready"
                error={null}
                activeIndex={0}
                actions={{
                    selectTop: vi.fn(),
                    editTop: vi.fn(),
                    addTop: vi.fn(),
                    retry: vi.fn(),
                    editSub: vi.fn(),
                    addSub: vi.fn(),
                }}
            />
        </TooltipProvider>,
    )
}

describe('MenuPhonePreview 添加一级菜单入口', () => {
    it('有叶子菜单时渲染加号按钮', () => {
        renderPreview([LEAF])
        expect(screen.getByLabelText('添加一级菜单')).toBeDefined()
    })

    it('一级菜单变为目录后仍渲染加号按钮', () => {
        renderPreview([{ id: 'group-1', name: '目录', subButton: [{ ...LEAF, id: 'child-1', name: '子菜单' }] }])
        expect(screen.getByLabelText('添加一级菜单')).toBeDefined()
    })

    it('达到三个一级菜单时不再渲染加号按钮', () => {
        renderPreview([LEAF, { ...LEAF, id: 'leaf-2', name: '菜单二' }, { ...LEAF, id: 'leaf-3', name: '菜单三' }])
        expect(screen.queryByLabelText('添加一级菜单')).toBeNull()
    })
})
