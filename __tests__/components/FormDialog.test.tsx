// @vitest-environment jsdom
/**
 * FormDialog 交互用例：覆盖字段区插槽、提交与取消两条回调路径、两档禁用状态。
 * 复用约定：渲染与查询走 @testing-library/react，点击用 user-event；
 * jsdom 环境由本文件首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：组件不持有字段状态、也不在提交成功后自行关闭，
 * 故用例只校验 onSubmit / onOpenChange 的回调事实，不断言弹窗随后消失。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormDialog } from '@webview/components/FormDialog'
import type { FormDialogProps } from '@webview/components/FormDialog'

afterEach(cleanup)

function renderDialog(overrides: Partial<FormDialogProps> = {}): ReturnType<typeof render> {
    return render(
        <FormDialog
            open
            title="新建作品"
            description="填写作品基础信息"
            submitLabel="创建"
            onOpenChange={vi.fn()}
            onSubmit={vi.fn()}
            {...overrides}
        >
            <p>字段区</p>
        </FormDialog>,
    )
}

describe('FormDialog', () => {
    it('渲染标题、说明、字段区与两个按钮', () => {
        renderDialog()

        expect(screen.getByRole('dialog')).toBeDefined()
        expect(screen.getByText('新建作品')).toBeDefined()
        expect(screen.getByText('填写作品基础信息')).toBeDefined()
        expect(screen.getByText('字段区')).toBeDefined()
        expect(screen.getByRole('button', { name: '创建' })).toBeDefined()
        expect(screen.getByRole('button', { name: '取消' })).toBeDefined()
    })

    it('open 为假时不渲染对话框', () => {
        renderDialog({ open: false })

        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('点击提交触发 onSubmit', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        renderDialog({ onSubmit })

        await user.click(screen.getByRole('button', { name: '创建' }))

        expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('点击取消只请求关闭，不触发 onSubmit', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        const onOpenChange = vi.fn()
        renderDialog({ onSubmit, onOpenChange })

        await user.click(screen.getByRole('button', { name: '取消' }))

        expect(onSubmit).not.toHaveBeenCalled()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('提交中两个按钮同时禁用', () => {
        renderDialog({ isSubmitting: true })

        expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
        expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    })

    it('校验未通过只禁用提交按钮，取消仍可用', () => {
        renderDialog({ isSubmitDisabled: true })

        expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
        expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(false)
    })
})
