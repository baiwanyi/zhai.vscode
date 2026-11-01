// @vitest-environment jsdom
/**
 * 流内问卷用例：覆盖选项映射、答案键与合并规则、过期后的拒绝分支。
 * 复用约定：渲染走 @testing-library/react，交互用 user-event，断言落在「回传什么决定」上；
 * 题目与选项的真实数据来自 SDK 的 AskUserQuestion 结构，用例按同一形状构造。
 * 关键约束：答案的键必须是问题原文（宿主按它并入工具入参），键被改写会让模型收到无主的答案；
 * 过期后只能回传拒绝 —— 宿主已按超时结算，此时再送答案会假装生效；
 * 写入类的是/否确认不在此组件，由 AiChatConfirmCard 单独覆盖。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiAskQuestion } from '@shared/types/aiChat'
import { AiChatQuestionnaire } from '@webview/workflow/aichat/layout/AiChatQuestionnaire'

const QUESTION = '这一章用第几人称？'

/** 构造一题提问：默认未过期之外的一切都按 SDK 结构给出 */
function makeQuestions(): AiAskQuestion[] {
    return [
        {
            question: QUESTION,
            header: '视角',
            options: [
                { label: '第一人称', description: '代入感强' },
                { label: '第三人称', description: '视野更宽' },
            ],
            multiSelect: false,
        },
    ]
}

afterEach(cleanup)

describe('流内问卷', () => {
    it('选中选项后提交，答案以问题原文为键回传', async () => {
        const onSubmit = vi.fn()
        render(<AiChatQuestionnaire questions={makeQuestions()} expiresAt={Date.now() + 180_000} onSubmit={onSubmit} />)
        const user = userEvent.setup()

        await user.click(screen.getByText('第一人称'))
        await user.click(screen.getByRole('button', { name: 'Submit' }))

        expect(onSubmit).toHaveBeenCalledTimes(1)
        expect(onSubmit.mock.calls[0]?.[0]).toEqual({
            allowed: true,
            answers: { [QUESTION]: '第一人称' },
        })
    })

    it('过期后提交只回传拒绝，不送答案', async () => {
        const onSubmit = vi.fn()
        render(<AiChatQuestionnaire questions={makeQuestions()} expiresAt={Date.now() - 1_000} onSubmit={onSubmit} />)
        const user = userEvent.setup()

        await user.click(screen.getByText('第一人称'))
        await user.click(screen.getByRole('button', { name: '已超时' }))

        expect(onSubmit).toHaveBeenCalledWith({ allowed: false })
    })
})
