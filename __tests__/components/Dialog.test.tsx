// @vitest-environment jsdom
/**
 * Dialog 交互用例：覆盖内容插槽、说明的可省略性、提交与取消两条回调路径、两档禁用状态。
 * 复用约定：渲染与查询走 @testing-library/react，点击用 user-event；
 * jsdom 环境由本文件首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：组件不持有内容状态、也不在提交成功后自行关闭，
 * 故用例只校验 onConfirm / onOpenChange 的回调事实，不断言弹窗随后消失。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@webview/components/Dialog'
import type { DialogProps } from '@webview/components/Dialog'

afterEach(cleanup)

function renderDialog(overrides: Partial<DialogProps> = {}): ReturnType<typeof render> {
    return render(
        <Dialog
            open
            title="新建作品"
            description="填写作品基础信息"
            confirmLabel="创建"
            onOpenChange={vi.fn()}
            onConfirm={vi.fn()}
            {...overrides}
        >
            <p>字段区</p>
        </Dialog>,
    )
}

describe('Dialog', () => {
    it('渲染标题、说明、字段区与两个按钮', () => {
        renderDialog()

        expect(screen.getByRole('dialog')).toBeDefined()
        expect(screen.getByText('新建作品')).toBeDefined()
        expect(screen.getByText('填写作品基础信息')).toBeDefined()
        expect(screen.getByText('字段区')).toBeDefined()
        expect(screen.getByRole('button', { name: '创建' })).toBeDefined()
        expect(screen.getByRole('button', { name: '取消' })).toBeDefined()
    })

    it('省略说明时不渲染可见说明文案', () => {
        renderDialog({ description: undefined })

        expect(screen.getByRole('dialog')).toBeDefined()
        expect(screen.queryByText('填写作品基础信息')).toBeNull()
    })

    it('open 为假时不渲染对话框', () => {
        renderDialog({ open: false })

        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('点击提交触发 onConfirm', async () => {
        const user = userEvent.setup()
        const onConfirm = vi.fn()
        renderDialog({ onConfirm })

        await user.click(screen.getByRole('button', { name: '创建' }))

        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('点击取消只请求关闭，不触发 onConfirm', async () => {
        const user = userEvent.setup()
        const onConfirm = vi.fn()
        const onOpenChange = vi.fn()
        renderDialog({ onConfirm, onOpenChange })

        await user.click(screen.getByRole('button', { name: '取消' }))

        expect(onConfirm).not.toHaveBeenCalled()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('提交中两个按钮同时禁用', () => {
        renderDialog({ isLoading: true })

        expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
        expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    })

    it('校验未通过只禁用提交按钮，取消仍可用', () => {
        renderDialog({ isDisabled: true })

        expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
        expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(false)
    })
})
