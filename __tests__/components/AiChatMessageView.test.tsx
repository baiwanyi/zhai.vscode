// @vitest-environment jsdom
/**
 * 单条消息用例：覆盖用户消息气泡外复制按钮的取值口径与成功 / 失败反馈、重新填入输入框的入口，
 * 以及取消态错误的呈现方式。
 * 复用约定：剪贴板与 toast 用替身，渲染走 @testing-library/react，交互用 user-event。
 * 关键约束：复制内容与气泡里看到的一致（命令名 + `@zhai\` 写法的引用 + 正文），写作命令的指令模板不进剪贴板；
 * 复制成功才切对勾，失败只提示不谎报成功；重复按钮只上报消息，回填范围由页面决定。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { AiMessage } from '@shared/types/aiChat'
import { AI_COMMAND_MAP } from '@webview/workflow/aichat/constants'
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

/** 构造一条带命令徽章与引用徽章的用户消息：复制与回填都要能覆盖这两块 */
function makeRichUserMessage(): AiMessage {
    return {
        ...makeMessage(`${AI_COMMAND_MAP.polish.instruction}\n\n把这一段收紧些`),
        refs: [
            {
                id: 'ref-1',
                kind: 'selection',
                label: 'notes/ch01.md:11-19',
                displayPath: 'notes/ch01.md',
                startLine: 11,
                endLine: 19,
                charCount: 320,
                isTruncated: false,
            },
        ],
    }
}

/** 构造一条已取消的助手消息：error 决定呈现 Alert 还是状态行 */
function makeCancelledAssistant(error: string | null): AiMessage {
    return {
        ...makeMessage(''),
        id: 'm3',
        role: 'assistant',
        status: 'cancelled',
        finishReason: 'cancelled',
        error,
    }
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

    it('复制内容带上命令名与引用标签，指令模板不进剪贴板', async () => {
        render(
            <TooltipProvider>
                <AiChatMessageView
                    message={makeRichUserMessage()}
                    pendingApproval={null}
                    onAnswer={(): void => undefined}
                />
            </TooltipProvider>,
        )
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '复制' }))

        expect(copyMock).toHaveBeenCalledWith('润色 @zhai\\notes\\ch01.md:11-19\n把这一段收紧些')
    })

    it('重复按钮把整条消息上报给调用方', async () => {
        const onRepeat = vi.fn()
        render(
            <TooltipProvider>
                <AiChatMessageView
                    message={makeRichUserMessage()}
                    pendingApproval={null}
                    onAnswer={(): void => undefined}
                    onRepeat={onRepeat}
                />
            </TooltipProvider>,
        )
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '重新填入输入框' }))

        expect(onRepeat).toHaveBeenCalledTimes(1)
        expect(onRepeat).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
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

describe('取消态的错误呈现', () => {
    /** 渲染一条消息：取消态的差异只在 error 字段 */
    function renderMessage(message: AiMessage): void {
        render(
            <TooltipProvider>
                <AiChatMessageView message={message} pendingApproval={null} onAnswer={(): void => undefined} />
            </TooltipProvider>,
        )
    }

    it('拒绝写入后仍用 Alert 说明原因', () => {
        renderMessage(makeCancelledAssistant('已拒绝这次写入，本轮已停止'))

        expect(screen.getByText('已拒绝这次写入，本轮已停止')).toBeTruthy()
        expect(screen.queryByText('已停止生成')).toBeNull()
    })

    it('审批超时后仍用 Alert 说明原因', () => {
        renderMessage(makeCancelledAssistant('写入确认超时，本轮已停止'))

        expect(screen.getByText('写入确认超时，本轮已停止')).toBeTruthy()
    })

    it('主动停止只留状态行，不出 Alert', () => {
        renderMessage(makeCancelledAssistant(null))

        expect(screen.getByText('已停止生成')).toBeTruthy()
    })

    it('存量数据里的英文内部错误不展示', () => {
        renderMessage(makeCancelledAssistant('Interrupted by user'))

        expect(screen.queryByText(/Interrupted by user/)).toBeNull()
        expect(screen.getByText('已停止生成')).toBeTruthy()
    })
})
