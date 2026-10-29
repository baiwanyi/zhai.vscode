/**
 * CodeBuddy 错误归类用例：覆盖工具权限被拒的英文原文转中文，以及未命中规则时保留原始异常。
 * 复用约定：直接断言返回值的 message，不触碰配置与网络。
 * 关键约束：权限拒绝的提示不得把工具名的英文原文带给用户，界面上一律是中文结果说明。
 */
import { describe, expect, it } from 'vitest'
import { CodebuddyError, toReadableCodebuddyError } from '../../src/modules/ai/providers/codebuddyError'

describe('错误文案', () => {
    it('工具权限被拒的英文原文转成中文', () => {
        const readable = toReadableCodebuddyError(new Error('Permission denied for tool(s): Edit'), 'deepseek')

        expect(readable.message).toBe('工具调用未获批准，本轮已停止')
        expect(readable.message).not.toContain('Permission denied')
    })

    it('归到 unknown 的分类错误同样转成中文', () => {
        const error = new CodebuddyError('unknown', 'Permission denied for tool(s): Edit, Write')

        expect(toReadableCodebuddyError(error, 'deepseek').message).toBe('工具调用未获批准，本轮已停止')
    })

    it('未命中任何规则时保留原始异常', () => {
        const error = new Error('some unexpected failure')

        expect(toReadableCodebuddyError(error)).toBe(error)
    })
})
