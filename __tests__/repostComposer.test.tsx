// @vitest-environment jsdom
/**
 * 转发框光标定位：引用内容由父级追加到草稿后，光标应落在新增内容末尾。
 * 重点锁住「聚焦 + selectionStart 到末尾」两件事——否则用户点引用后继续打字会插到引用内容之前。
 * 只渲染一次再 rerender 出新草稿与自增信号，贴近列表里真实的更新顺序。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepostComposer, type RepostComposerProps } from '../src/weibo/block/RepostComposer'

/** 引用后的草稿：与 hook 里拼出的形状一致 */
const QUOTED_DRAFT = '//@测试作者：转发附言'

/** 除 draft 与信号外的固定回调：用例不关心它们 */
const handlers: Omit<RepostComposerProps, 'draft' | 'focusEndSignal'> = {
    shouldComment: false,
    draftLimit: 500,
    isDraftOverLimit: false,
    isSubmitting: false,
    onDraftChange: vi.fn(),
    onShouldCommentChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSubmit: vi.fn(),
}

describe('RepostComposer', () => {
    afterEach(() => {
        cleanup()
    })

    it('引用后聚焦输入框并把光标放到草稿末尾', () => {
        const { rerender } = render(<RepostComposer {...handlers} draft="" focusEndSignal={0} />)

        rerender(<RepostComposer {...handlers} draft={QUOTED_DRAFT} focusEndSignal={1} />)

        const textarea = screen.getByLabelText<HTMLTextAreaElement>('转发附言')
        expect(document.activeElement).toBe(textarea)
        expect(textarea.selectionStart).toBe(QUOTED_DRAFT.length)
    })

    it('没有引用信号时不主动抢焦点', () => {
        render(<RepostComposer {...handlers} draft="" />)

        const textarea = screen.getByLabelText<HTMLTextAreaElement>('转发附言')
        expect(document.activeElement).not.toBe(textarea)
    })
})
