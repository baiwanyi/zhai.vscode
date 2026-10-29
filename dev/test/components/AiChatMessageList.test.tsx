// @vitest-environment jsdom
/**
 * 消息流容器用例：只覆盖「确认事项出现时把视图拉回底部」这一条交互。
 * 复用约定：滚动容器整体替身化（jsdom 无布局，真实 MessageScroller 无从测量），
 * 用 spy 观察 scrollToEnd 的调用次数与时机。
 * 关键约束：同一事项只滚一次 —— 依赖项里的 scrollToEnd 引用不稳定，重复触发会把用户
 * 刚翻到的位置反复拽走；换一条事项才允许再滚。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiPermissionRequest } from '@shared/types/aiChat'
import { AiChatMessageList } from '@webview/workflow/aichat/layout/AiChatMessageList'
import type { JSX, ReactNode } from 'react'

const { scrollToEndMock } = vi.hoisted(() => ({ scrollToEndMock: vi.fn(() => true) }))

/** 滚动容器替身：只保留 children 透传，useMessageScroller 返回 spy */
vi.mock('@components/ui/message-scroller', () => {
    const Pass = ({ children }: { children?: ReactNode }): JSX.Element => <div>{children}</div>
    const renderNull = (): null => null
    const useScroller = (): { scrollToEnd: typeof scrollToEndMock } => ({ scrollToEnd: scrollToEndMock })
    return {
        MessageScroller: Pass,
        MessageScrollerButton: renderNull,
        MessageScrollerContent: Pass,
        MessageScrollerItem: Pass,
        MessageScrollerProvider: Pass,
        MessageScrollerViewport: Pass,
        useMessageScroller: useScroller,
    }
})

/** 空态替身：本用例不关心首屏引导，避免引入运行时依赖 */
vi.mock('@webview/workflow/aichat/layout/AiChatEmptyState', () => {
    const renderNull = (): null => null
    return { AiChatEmptyState: renderNull }
})

const BASE_PROPS = {
    messages: [],
    lastMessageId: undefined,
    phase: 'idle' as const,
    transientNotice: null,
    onAnswer: (): void => undefined,
    runtime: null,
    onLoginCodebuddy: (): void => undefined,
}

/** 构造一条待确认事项：写入确认 */
function makeApproval(id: string): AiPermissionRequest {
    return {
        id,
        kind: 'tool',
        toolName: 'Edit',
        detail: 'd:/press/剑来/Chapters/c1.md',
        effect: '该操作会修改磁盘文件，确认后立即执行。',
        editablePath: 'd:/press/剑来/Chapters/c1.md',
        questions: [],
        messageId: 'msg-1',
        expiresAt: Date.now() + 60_000,
    }
}

beforeEach(() => {
    scrollToEndMock.mockClear()
})

afterEach(cleanup)

describe('确认卡片的自动滚动', () => {
    it('事项出现时滚到底，同一事项不重复滚，换事项再滚一次', () => {
        const { rerender } = render(<AiChatMessageList {...BASE_PROPS} pendingApproval={null} />)
        expect(scrollToEndMock).not.toHaveBeenCalled()

        const approval = makeApproval('tu-1')
        rerender(<AiChatMessageList {...BASE_PROPS} pendingApproval={approval} />)
        expect(scrollToEndMock).toHaveBeenCalledTimes(1)

        // 同一条事项重复渲染不应再次拽动视图
        rerender(<AiChatMessageList {...BASE_PROPS} pendingApproval={approval} />)
        expect(scrollToEndMock).toHaveBeenCalledTimes(1)

        rerender(<AiChatMessageList {...BASE_PROPS} pendingApproval={makeApproval('tu-2')} />)
        expect(scrollToEndMock).toHaveBeenCalledTimes(2)
    })
})
