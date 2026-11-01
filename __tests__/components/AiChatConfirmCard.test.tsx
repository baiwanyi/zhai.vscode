// @vitest-environment jsdom
/**
 * 是/否确认卡片用例：覆盖标题与说明文案、允许带回原路径、拒绝不带路径、写入内容预览的展开收起与截断标注，
 * 以及倒计时与超时自动拒绝。
 * 复用约定：渲染走 @testing-library/react，交互用 user-event，断言落在「回传什么决定」与「决定前看得到什么」上。
 * 关键约束：写入确认只有两个出口 —— 允许必须带回目标路径（宿主据此执行），
 * 拒绝不得携带任何路径（宿主按拒绝结算）；标题只报动作，说明由宿主给整句、原样渲染；
 * 预览默认展开，收起后原文与新文都必须离开 DOM，截断时摘要必须标注「已截断」；
 * 倒计时只报剩余秒数、不足 10 秒转破坏性配色、归零自动回传拒绝，且同一张卡片只结算一次；
 * 风险说明必须取自宿主下发的 effect，因此夹具用区别于生产文案的独占字符串。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiPermissionRequest } from '@shared/types/aiChat'
import { AiChatConfirmCard } from '@webview/workflow/aichat/layout/AiChatConfirmCard'

const TARGET = 'd:/press/剑来/Chapters/c1.md'
/** 目标文件名：宿主给的整句里也带它，前端不自行拆分 */
const FILE_NAME = 'c1.md'
/** 风险说明：宿主下发的完整句子，用独占字符串避免与组件内可能残留的硬编码文案混淆 */
const EFFECT = `文件 「${FILE_NAME}」 测试用风险说明：仅此字符串可被命中。`
/** 将被替换的原文：预览默认展开时必须出现在 DOM 中 */
const REMOVED_TEXT = '他把剑收回鞘中。'
/** 将写入的新文：同上 */
const ADDED_TEXT = '他把剑重新收回鞘中，转身走了。'

/** 构造一条写入确认：与宿主 confirmWrite 下发的形状一致 */
function makeRequest(): AiPermissionRequest {
    return {
        id: 'tu-2',
        kind: 'tool',
        toolName: 'Edit',
        detail: TARGET,
        effect: EFFECT,
        editablePath: TARGET,
        preview: [{ content: ADDED_TEXT, removed: REMOVED_TEXT, truncated: false }],
        questions: [],
        messageId: 'msg-1',
        expiresAt: Date.now() + 60_000,
    }
}

afterEach(cleanup)

describe('是/否确认卡片', () => {
    it('标题报动作，说明原样渲染宿主给的整句', () => {
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={vi.fn()} />)

        expect(screen.getByText('允许修改文件？')).toBeTruthy()
        expect(screen.getByText(EFFECT)).toBeTruthy()
        expect(screen.queryByText(new RegExp(TARGET))).toBeNull()
    })

    it('选中允许时按原路径回传', async () => {
        const onSubmit = vi.fn()
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={onSubmit} />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '允许' }))

        expect(onSubmit).toHaveBeenCalledWith({ allowed: true, path: TARGET })
    })

    it('选中拒绝时只回传拒绝，不带路径', async () => {
        const onSubmit = vi.fn()
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={onSubmit} />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '拒绝' }))

        expect(onSubmit).toHaveBeenCalledWith({ allowed: false })
    })

    it('预览默认展开：决定前不需要再点一次才能读到内容', () => {
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={vi.fn()} />)

        expect(screen.getByText('将要写入的内容')).toBeTruthy()
        expect(screen.getByText(REMOVED_TEXT)).toBeTruthy()
        expect(screen.getByText(ADDED_TEXT)).toBeTruthy()
    })

    it('可以收起预览，长文不再占据阅读区', async () => {
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={vi.fn()} />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: /将要写入的内容/ }))

        expect(screen.queryByText(REMOVED_TEXT)).toBeNull()
        expect(screen.queryByText(ADDED_TEXT)).toBeNull()
    })

    it('未到期时在右上角显示倒计时', () => {
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={vi.fn()} />)

        expect(screen.getByRole('timer').textContent).toMatch(/^\d+ 秒$/)
        expect(screen.getByRole('timer').getAttribute('data-variant')).toBe('secondary')
    })

    it('剩余不足 10 秒时倒计时转为破坏性配色', () => {
        const urgent: AiPermissionRequest = { ...makeRequest(), expiresAt: Date.now() + 5_000 }
        render(<AiChatConfirmCard request={urgent} onSubmit={vi.fn()} />)

        expect(screen.getByRole('timer').getAttribute('data-variant')).toBe('destructive')
    })

    it('倒计时结束仍未选择时按拒绝结算，徽标只报 0 秒不加超时文案', () => {
        const onSubmit = vi.fn()
        const expired: AiPermissionRequest = { ...makeRequest(), expiresAt: Date.now() - 1 }
        render(<AiChatConfirmCard request={expired} onSubmit={onSubmit} />)

        expect(screen.getByRole('timer').textContent).toBe('0 秒')
        expect(screen.queryByText(/已超时/)).toBeNull()
        expect(onSubmit).toHaveBeenCalledWith({ allowed: false })
    })

    it('同一张卡片只结算一次：先点拒绝后点允许不会重复回传', async () => {
        const onSubmit = vi.fn()
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={onSubmit} />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '拒绝' }))
        await user.click(screen.getByRole('button', { name: '允许' }))

        expect(onSubmit).toHaveBeenCalledTimes(1)
        expect(onSubmit).toHaveBeenCalledWith({ allowed: false })
    })

    it('内容被截断时摘要给出标注，不把不完整的内容当成全文', () => {
        const truncated: AiPermissionRequest = {
            ...makeRequest(),
            preview: [{ content: ADDED_TEXT, removed: null, truncated: true }],
        }
        render(<AiChatConfirmCard request={truncated} onSubmit={vi.fn()} />)

        expect(screen.getByText(/已截断/)).toBeTruthy()
    })
})
