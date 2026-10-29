/**
 * 审批桥测试：覆盖等待期限的透传、归属消息与截止时间的注入，以及超时与重复结算的收口。
 * 复用约定：不触网、不弹窗，用记录型 emit 替身观察下发载荷；超时用毫秒级参数快速跑完。
 * 关键约束：提问类必须带 expiresAt（前端据此提示剩余时间），工具审批不带 ——
 * 两者混用会让写入确认也显示倒计时，与实际超时口径不符。
 */
import { describe, expect, it } from 'vitest'
import type { AiPermissionRequest } from '../../src/shared/types/aiChat'
import { PermissionBroker } from '../../src/modules/ai/permissionBroker'

const QUESTION_TEXT = '用第几人称？'

const QUESTION_REQUEST: AiPermissionRequest = {
    id: 'tu-1',
    kind: 'question',
    toolName: 'AskUserQuestion',
    detail: '待确认 1 个问题',
    effect: '回答后模型会继续执行本轮任务。',
    editablePath: null,
    questions: [
        {
            question: QUESTION_TEXT,
            header: '视角',
            options: [{ label: '第一人称', description: '代入感强' }],
            multiSelect: false,
        },
    ],
}

const TOOL_REQUEST: AiPermissionRequest = {
    id: 'tu-2',
    kind: 'tool',
    toolName: 'Edit',
    detail: 'd:/press/剑来/Chapters/c1.md',
    effect: '该操作会修改磁盘文件，确认后立即执行。',
    editablePath: 'd:/press/剑来/Chapters/c1.md',
    questions: [],
}

describe('审批桥', () => {
    it('提问类下发归属消息与截止时间', async () => {
        const emitted: AiPermissionRequest[] = []
        const broker = new PermissionBroker((request) => emitted.push(request), 'msg-9')
        const pending = broker.request(QUESTION_REQUEST, 180_000)

        expect(emitted).toHaveLength(1)
        expect(emitted[0]?.messageId).toBe('msg-9')
        expect(emitted[0]?.expiresAt).toBeGreaterThan(Date.now())

        expect(broker.resolve('tu-1', { allowed: true, answers: { [QUESTION_TEXT]: '第一人称' } })).toBe(true)
        await expect(pending).resolves.toEqual({ allowed: true, answers: { [QUESTION_TEXT]: '第一人称' } })
    })

    it('工具审批同样补归属消息与截止时间：写入确认也在消息流内作答', async () => {
        const emitted: AiPermissionRequest[] = []
        const broker = new PermissionBroker((request) => emitted.push(request), 'msg-9')
        const pending = broker.request(TOOL_REQUEST)

        expect(emitted[0]?.messageId).toBe('msg-9')
        expect(emitted[0]?.expiresAt).toBeGreaterThan(Date.now())

        broker.resolve('tu-2', { allowed: true })
        await pending
    })

    it('超时按传入期限结算为拒绝', async () => {
        const broker = new PermissionBroker(() => undefined)
        await expect(broker.request(TOOL_REQUEST, 1)).resolves.toEqual({ allowed: false })
    })

    it('写入被用户拒绝时留下标记，超时与提问跳过都不算', async () => {
        const broker = new PermissionBroker(() => undefined)
        const editPending = broker.request(TOOL_REQUEST, 10_000)
        broker.resolve('tu-2', { allowed: false })
        await editPending
        expect(broker.hasUserDenied).toBe(true)

        // 提问被跳过不代表整轮被否决：模型会继续换个问法
        const questionBroker = new PermissionBroker(() => undefined)
        const askPending = questionBroker.request(QUESTION_REQUEST, 10_000)
        questionBroker.resolve('tu-1', { allowed: false })
        await askPending
        expect(questionBroker.hasUserDenied).toBe(false)

        // 超时是宿主自动拒绝，不是用户决定
        const timeoutBroker = new PermissionBroker(() => undefined)
        await timeoutBroker.request(TOOL_REQUEST, 1)
        expect(timeoutBroker.hasUserDenied).toBe(false)
    })

    it('同一 id 只结算一次，重复回包被忽略', async () => {
        const broker = new PermissionBroker(() => undefined)
        const pending = broker.request(TOOL_REQUEST, 10_000)

        expect(broker.resolve('tu-2', { allowed: true })).toBe(true)
        expect(broker.resolve('tu-2', { allowed: false })).toBe(false)
        await expect(pending).resolves.toEqual({ allowed: true })
    })
})
