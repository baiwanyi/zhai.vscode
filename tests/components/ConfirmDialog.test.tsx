// @vitest-environment jsdom
/**
 * ConfirmDialog 交互用例：覆盖确认 / 取消两条回调路径与提交中、破坏性两档状态。
 * 复用约定：渲染与查询走 @testing-library/react，点击用 user-event 以贴近真实指针序列；
 * jsdom 环境由本文件首行指令声明，不影响其余 Node 环境用例。
 * 关键约束：组件刻意不自行关闭弹窗（关闭时机由调用方在 onConfirm 内决定），
 * 因此断言只校验「onConfirm 被调用」与「onOpenChange 收到 false」，不校验节点是否被移除。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'

afterEach(cleanup)

const BASE_PROPS = {
    open: true,
    title: '删除作品',
    description: '删除后无法恢复',
    confirmLabel: '删除',
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
}

describe('ConfirmDialog', () => {
    it('open 为真时渲染标题、说明与两个按钮', () => {
        render(<ConfirmDialog {...BASE_PROPS} />)

        expect(screen.getByRole('alertdialog')).toBeDefined()
        expect(screen.getByText('删除作品')).toBeDefined()
        expect(screen.getByText('删除后无法恢复')).toBeDefined()
        expect(screen.getByRole('button', { name: '删除' })).toBeDefined()
        expect(screen.getByRole('button', { name: '取消' })).toBeDefined()
    })

    it('open 为假时不渲染对话框', () => {
        render(<ConfirmDialog {...BASE_PROPS} open={false} />)

        expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('点击确认触发 onConfirm，并由 alert-dialog 请求关闭', async () => {
        const user = userEvent.setup()
        const onConfirm = vi.fn()
        const onOpenChange = vi.fn()
        render(<ConfirmDialog {...BASE_PROPS} onConfirm={onConfirm} onOpenChange={onOpenChange} />)

        await user.click(screen.getByRole('button', { name: '删除' }))

        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('点击取消只请求关闭，不触发 onConfirm', async () => {
        const user = userEvent.setup()
        const onConfirm = vi.fn()
        const onOpenChange = vi.fn()
        render(<ConfirmDialog {...BASE_PROPS} onConfirm={onConfirm} onOpenChange={onOpenChange} />)

        await user.click(screen.getByRole('button', { name: '取消' }))

        expect(onConfirm).not.toHaveBeenCalled()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('cancelLabel 覆盖默认取消文案', () => {
        render(<ConfirmDialog {...BASE_PROPS} cancelLabel="返回" />)

        expect(screen.getByRole('button', { name: '返回' })).toBeDefined()
        expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    })

    it('提交中两个按钮同时禁用', () => {
        render(<ConfirmDialog {...BASE_PROPS} isSubmitting />)

        expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
        expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    })

    it('破坏性操作给确认按钮加 destructive 变体类名', () => {
        render(<ConfirmDialog {...BASE_PROPS} isDestructive />)

        expect(screen.getByRole('button', { name: '删除' }).className).toContain('destructive')
    })
})
