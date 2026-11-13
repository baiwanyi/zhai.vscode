// @vitest-environment jsdom
/**
 * QueryDialog 交互用例：验证「打开即查、无输入框、等待态只给 spinner、完成才出正文」。
 * 复用约定：查询状态由外部注入，用例自己造 UseDocumentQueryResult，不触达宿主协议；
 * 渲染与等待走 @testing-library/react，StrictMode 用来验证自动发起不会被打成两次。
 * 关键约束：生成期间不展示流式增量、也不提供停止或重试；关闭必须复位发起标记，
 * 否则再次打开会静默不查询。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseDocumentQueryResult } from '@webview/editor/hooks/useDocumentQuery'
import { QueryDialog } from '@webview/editor/layout/QueryDialog'

afterEach(cleanup)

/** 造一份查询状态：start / abort 用 mock，其它字段给空值 */
function createQuery(overrides: Partial<UseDocumentQueryResult> = {}): UseDocumentQueryResult {
    return {
        status: 'idle',
        content: '',
        error: null,
        isFromCache: false,
        history: [],
        start: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        loadHistory: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        ...overrides,
    }
}

const QUOTE = '山不在高，有仙则名'

describe('QueryDialog', () => {
    it('打开即发起一次解释查询，且没有输入框', async () => {
        const query = createQuery()
        render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        expect(screen.queryByRole('textbox')).toBeNull()
        expect(screen.getByRole('status')).toBeDefined()
        expect(screen.getByText('正在生成…')).toBeDefined()
        await waitFor(() => {
            expect(query.start).toHaveBeenCalledTimes(1)
        })
        const call = vi.mocked(query.start).mock.calls[0]
        expect(call?.[0]).toBe(QUOTE)
        expect(call?.[1]).toContain('解释')
    })

    it('生成期间只显示 spinner，不展示增量内容，也没有停止按钮', () => {
        const query = createQuery({ status: 'streaming', content: '半截内容' })
        render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        expect(screen.getByRole('status')).toBeDefined()
        expect(screen.getByText('正在生成…')).toBeDefined()
        expect(screen.queryByText('半截内容')).toBeNull()
        expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
        // 关闭只剩 DialogContent 右上角的默认按钮（可访问名取自 sr-only 的 Close）
        expect(screen.getByRole('button', { name: 'Close' })).toBeDefined()
    })

    it('完成后展示正文、spinner 消失且没有重试按钮', () => {
        const query = createQuery({ status: 'done', content: '完整结果' })
        render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        expect(screen.getByText('完整结果')).toBeDefined()
        expect(screen.queryByText('正在生成…')).toBeNull()
        expect(screen.queryByRole('button', { name: '重新解释' })).toBeNull()
        expect(screen.queryByRole('button', { name: '再查一次' })).toBeNull()
    })

    it('查询失败时用 alert 展示原因', () => {
        const query = createQuery({ status: 'error', error: 'AI 通道未就绪' })
        render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        expect(screen.getByRole('alert')).toBeDefined()
        expect(screen.getByText('查询失败')).toBeDefined()
        expect(screen.getByText('AI 通道未就绪')).toBeDefined()
    })

    it('缓存命中时用 alert 说明未消耗额度', () => {
        const query = createQuery({ status: 'done', content: '结果', isFromCache: true })
        render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        expect(screen.getByRole('alert')).toBeDefined()
        expect(screen.getByText('来自缓存：本次未调用模型，也未消耗额度')).toBeDefined()
    })

    it('引用为空时提示没有可解释的文本', () => {
        const query = createQuery()
        render(<QueryDialog isOpen quote="   " onOpenChange={vi.fn()} query={query} />)

        expect(screen.getByText('没有可解释的文本')).toBeDefined()
        expect(screen.queryByRole('status')).toBeNull()
    })

    it('StrictMode 下自动发起仍只发一次', async () => {
        const query = createQuery()
        render(
            <StrictMode>
                <QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />
            </StrictMode>,
        )

        await waitFor(() => {
            expect(query.start).toHaveBeenCalledTimes(1)
        })
    })

    it('关闭再打开会重新发起一次', async () => {
        const query = createQuery()
        const { rerender } = render(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)
        await waitFor(() => {
            expect(query.start).toHaveBeenCalledTimes(1)
        })

        rerender(<QueryDialog isOpen={false} quote={QUOTE} onOpenChange={vi.fn()} query={query} />)
        rerender(<QueryDialog isOpen quote={QUOTE} onOpenChange={vi.fn()} query={query} />)

        await waitFor(() => {
            expect(query.start).toHaveBeenCalledTimes(2)
        })
    })
})
