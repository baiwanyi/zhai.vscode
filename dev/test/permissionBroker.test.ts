/**
 * 审批桥测试：覆盖等待期限的透传、归属消息与截止时间的注入、超时与重复结算的收口，
 * 以及「写入审批未获批准」原因的记录口径。
 * 复用约定：不触网、不弹窗，用记录型 emit 替身观察下发载荷；超时用毫秒级参数快速跑完。
 * 关键约束：两类事项都要带 expiresAt —— 写入确认靠它显示倒计时、提问靠它提示剩余时间；
 * 写入类未获批准要记下原因（拒绝 / 超时），提问跳过不记，否则上层给不出正确的中文说明。
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
    preview: null,
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
    effect: '文件 「c1.md」 将被修改，确认后立即执行。',
    editablePath: 'd:/press/剑来/Chapters/c1.md',
    preview: null,
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

    it('写入被用户拒绝时记下原因，提问跳过不算', async () => {
        const broker = new PermissionBroker(() => undefined)
        const editPending = broker.request(TOOL_REQUEST, 10_000)
        broker.resolve('tu-2', { allowed: false })
        await editPending
        expect(broker.writeDenialReason).toBe('user')

        // 提问被跳过不代表整轮被否决：模型会继续换个问法
        const questionBroker = new PermissionBroker(() => undefined)
        const askPending = questionBroker.request(QUESTION_REQUEST, 10_000)
        questionBroker.resolve('tu-1', { allowed: false })
        await askPending
        expect(questionBroker.writeDenialReason).toBeNull()
    })

    it('写入审批超时记为 timeout：与主动拒绝是两种原因', async () => {
        const broker = new PermissionBroker(() => undefined)

        await expect(broker.request(TOOL_REQUEST, 1)).resolves.toEqual({ allowed: false })

        expect(broker.writeDenialReason).toBe('timeout')
    })

    it('提问超时不记录原因：模型可以换个方式继续问', async () => {
        const broker = new PermissionBroker(() => undefined)

        await expect(broker.request(QUESTION_REQUEST, 1)).resolves.toEqual({ allowed: false })

        expect(broker.writeDenialReason).toBeNull()
    })

    it('先拒绝后超时只记首次原因，不被后续覆盖', async () => {
        const broker = new PermissionBroker(() => undefined)
        const first = broker.request(TOOL_REQUEST, 10_000)
        broker.resolve('tu-2', { allowed: false })
        await first

        await broker.request({ ...TOOL_REQUEST, id: 'tu-3' }, 1)

        expect(broker.writeDenialReason).toBe('user')
    })

    it('同一 id 只结算一次，重复回包被忽略', async () => {
        const broker = new PermissionBroker(() => undefined)
        const pending = broker.request(TOOL_REQUEST, 10_000)

        expect(broker.resolve('tu-2', { allowed: true })).toBe(true)
        expect(broker.resolve('tu-2', { allowed: false })).toBe(false)
        await expect(pending).resolves.toEqual({ allowed: true })
    })
})
