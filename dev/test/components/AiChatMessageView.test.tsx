// @vitest-environment jsdom
/**
 * 单条消息用例：覆盖用户消息气泡外复制按钮的取值口径与成功 / 失败两种反馈。
 * 复用约定：剪贴板与 toast 用替身，渲染走 @testing-library/react，交互用 user-event。
 * 关键约束：只复制用户写下的正文 —— 写作命令的指令模板不进剪贴板；
 * 复制成功才切对勾，失败只提示不谎报成功。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { AiMessage } from '@shared/types/aiChat'
import { AiChatMessageView } from '@webview/workflow/aichat/layout/AiChatMessageView'

const { copyMock, toastErrorMock } = vi.hoisted(() => ({
    copyMock: vi.fn(() => Promise.resolve(true)),
    toastErrorMock: vi.fn(),
}))

vi.mock('@shared/utils/clipboard', () => ({ copyToClipboard: copyMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

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

/** 构造一条用户消息：只给正文，其余字段取默认值 */
function makeMessage(content: string): AiMessage {
    return {
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content,
        reasoning: null,
        steps: [],
        status: 'completed',
        finishReason: null,
        error: null,
        refs: [],
        totalTokens: 0,
        durationMs: 0,
        tokensEstimated: false,
        credits: null,
        createdAt: '2026-10-29T10:00:00.000Z',
    }
}

/** 构造一条空的助手消息：用于待首字的加载态 */
function makePendingAssistant(): AiMessage {
    return { ...makeMessage(''), id: 'm2', role: 'assistant', status: 'streaming' }
}

beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub
})

beforeEach(() => {
    copyMock.mockClear()
    copyMock.mockImplementation(() => Promise.resolve(true))
    toastErrorMock.mockClear()
})

afterEach(cleanup)

describe('用户消息气泡外的复制按钮', () => {
    it('复制正文原文，成功后按钮切为已复制', async () => {
        render(
            <TooltipProvider>
                <AiChatMessageView
                    message={makeMessage('请改写这段')}
                    pendingApproval={null}
                    onAnswer={(): void => undefined}
                />
            </TooltipProvider>,
        )
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '复制' }))

        expect(copyMock).toHaveBeenCalledWith('请改写这段')
        await waitFor(() => {
            expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
        })
    })

    it('助手消息待首字时展示文字状态行，而不是裸转圈', () => {
        render(
            <TooltipProvider>
                <AiChatMessageView
                    message={makePendingAssistant()}
                    pendingApproval={null}
                    onAnswer={(): void => undefined}
                />
            </TooltipProvider>,
        )

        expect(screen.getByText('正在思考…')).toBeTruthy()
    })

    it('复制失败时提示错误，不切成功态', async () => {
        copyMock.mockImplementation(() => Promise.resolve(false))
        render(
            <TooltipProvider>
                <AiChatMessageView
                    message={makeMessage('请改写这段')}
                    pendingApproval={null}
                    onAnswer={(): void => undefined}
                />
            </TooltipProvider>,
        )
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '复制' }))

        expect(toastErrorMock).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    })
})
