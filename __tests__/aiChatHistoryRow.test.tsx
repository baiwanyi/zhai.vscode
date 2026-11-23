// @vitest-environment jsdom
/**
 * AiChatHistoryRow 用例：行主体与删除按钮是两个平级入口，互不触发。
 * 复用约定：@testing-library/react 的 render + 无障碍查询，按钮语义由 aria-label 或内容文本承载；
 * 行内删除按钮的 tooltip 需要 TooltipProvider 包裹。
 * 关键约束：焦点在删除按钮上按 Enter / 空格时不得触发整行的选择回调 —— 这是「切换 + 删除」
 * 同时发生的回归点，行结构一旦把删除按钮套回主体就会复现。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { TooltipProvider } from '@webview/components/Tooltip'
import { AiChatHistoryRow } from '@webview/workflow/aichat/history/layout/AiChatHistoryRow'

// 未开启 vitest globals 时 @testing-library/react 不会自动清理，用例之间 DOM 会累积、getByText 命中多份
afterEach(() => {
    cleanup()
})

const TITLE = '第一章的对话'

function createSession(overrides: Partial<AiConversationSummary> = {}): AiConversationSummary {
    return {
        id: 'conv-1',
        title: TITLE,
        updatedAt: '2026-09-18T10:00:00.000Z',
        scopeKind: 'press',
        scopeLabel: '剑来',
        scopeKey: 'press/剑来',
        ...overrides,
    }
}

/** 行主体：用标题文本反查最近的 [role="button"]，取不到直接抛错而不是靠非空断言 */
function readRow(): HTMLElement {
    const row = screen.getByText(TITLE).closest<HTMLElement>('[role="button"]')
    if (row === null) {
        throw new Error('未找到行主体')
    }
    return row
}

function renderRow(
    options: {
        isActive?: boolean
        onSelect?: () => void
        onDelete?: () => void
    } = {},
): { onSelect: ReturnType<typeof vi.fn>; onDelete: ReturnType<typeof vi.fn> } {
    const onSelect = vi.fn(options.onSelect)
    const onDelete = vi.fn(options.onDelete)
    render(
        <TooltipProvider>
            <AiChatHistoryRow
                session={createSession()}
                isActive={options.isActive ?? false}
                onSelect={onSelect}
                onDelete={onDelete}
            />
        </TooltipProvider>,
    )
    return { onSelect, onDelete }
}

describe('AiChatHistoryRow', () => {
    it('点击主体只切换会话', () => {
        const { onSelect, onDelete } = renderRow()
        fireEvent.click(readRow())
        expect(onSelect).toHaveBeenCalledWith('conv-1')
        expect(onDelete).not.toHaveBeenCalled()
    })

    it('点击删除按钮只删除会话', () => {
        const { onSelect, onDelete } = renderRow()
        fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
        expect(onDelete).toHaveBeenCalledWith('conv-1')
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('主体按 Enter 切换会话', () => {
        const { onSelect } = renderRow()
        fireEvent.keyDown(readRow(), { key: 'Enter' })
        expect(onSelect).toHaveBeenCalledWith('conv-1')
    })

    it('删除按钮上按 Enter 不触发切换', () => {
        const { onSelect } = renderRow()
        fireEvent.keyDown(screen.getByRole('button', { name: '删除会话' }), { key: 'Enter' })
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('删除按钮上按空格不触发切换', () => {
        const { onSelect } = renderRow()
        fireEvent.keyDown(screen.getByRole('button', { name: '删除会话' }), { key: ' ' })
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('当前会话带 aria-current，其余不带', () => {
        renderRow({ isActive: true })
        expect(readRow().getAttribute('aria-current')).toBe('true')
    })

    it('行内显示来源与时间', () => {
        renderRow()
        expect(screen.getByText(/作品 · 剑来/)).toBeTruthy()
    })
})
