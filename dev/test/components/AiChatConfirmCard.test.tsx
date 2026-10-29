// @vitest-environment jsdom
/**
 * 是/否确认卡片用例：覆盖标题与说明文案、允许带回原路径、拒绝不带路径三条。
 * 复用约定：渲染走 @testing-library/react，交互用 user-event，断言落在「回传什么决定」上。
 * 关键约束：写入确认只有两个出口 —— 允许必须带回目标路径（宿主据此执行），
 * 拒绝不得携带任何路径（宿主按拒绝结算）；标题只报动作，说明只给文件名、完整路径进 title；
 * 风险说明必须取自宿主下发的 effect，因此夹具用区别于生产文案的独占字符串。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiPermissionRequest } from '@shared/types/aiChat'
import { AiChatConfirmCard } from '@webview/workflow/aichat/layout/AiChatConfirmCard'

const TARGET = 'd:/press/剑来/Chapters/c1.md'
/** 风险说明：用独占字符串，避免与组件内可能残留的硬编码文案混淆 */
const EFFECT = '测试用风险说明：仅此字符串可被命中。'

/** 构造一条写入确认：与宿主 confirmWrite 下发的形状一致 */
function makeRequest(): AiPermissionRequest {
    return {
        id: 'tu-2',
        kind: 'tool',
        toolName: 'Edit',
        detail: TARGET,
        effect: EFFECT,
        editablePath: TARGET,
        questions: [],
        messageId: 'msg-1',
        expiresAt: Date.now() + 60_000,
    }
}

afterEach(cleanup)

describe('是/否确认卡片', () => {
    it('标题报动作，说明只给文件名并把完整路径放进悬浮提示', () => {
        render(<AiChatConfirmCard request={makeRequest()} onSubmit={vi.fn()} />)

        expect(screen.getByText('允许修改文件？')).toBeTruthy()
        const target = screen.getByText('c1.md')
        expect(target.getAttribute('title')).toBe(TARGET)
        expect(screen.queryByText(new RegExp(TARGET))).toBeNull()
        expect(screen.getByText(new RegExp(EFFECT))).toBeTruthy()
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
})
