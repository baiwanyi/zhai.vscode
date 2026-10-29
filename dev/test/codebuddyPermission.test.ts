/**
 * 工具权限守卫测试：覆盖只读与写入的路径边界、审批模式的三种走向，以及提问工具的答案回传。
 * 复用约定：审批桥用纯函数替身，不触网也不弹窗；路径取系统临时目录，不依赖具体盘符。
 * 关键约束：断言只看守卫返回值（allow / deny 与 updatedInput），不断言日志措辞；
 * 路径比较用 resolve 后的绝对值，避免大小写与分隔符差异导致误判。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiPermissionChannel, AiToolPolicy } from '../../src/modules/ai/provider'
import type { AiPermissionDecision, AiPermissionRequest } from '../../src/shared/types/aiChat'
import type { CanUseToolOptions } from '@tencent-ai/agent-sdk'
import { createToolGuard } from '../../src/modules/ai/providers/codebuddyPermission'

/** 白名单根：读取根为临时目录下的测试目录，写入根再收窄一层作品目录 */
const READ_ROOT = path.join(os.tmpdir(), 'zhai-perm-test')
const WRITE_ROOT = path.join(READ_ROOT, 'press')

/** 越界路径：与白名单根同级，任何授权都不应放行 */
const OUTSIDE_FILE = path.join(os.tmpdir(), 'zhai-perm-outside', 'a.md')

const CALL_OPTIONS: CanUseToolOptions = {
    signal: new AbortController().signal,
    toolUseID: 'tu-1',
}

/** 构造策略：默认自动放行，用例按需覆盖审批模式与写入根 */
function makePolicy(overrides: Partial<AiToolPolicy> = {}): AiToolPolicy {
    return {
        tools: [],
        readRoots: [READ_ROOT],
        writeRoots: [WRITE_ROOT],
        approval: 'auto',
        maxTurns: 10,
        cwd: READ_ROOT,
        ...overrides,
    }
}

/** 审批桥替身：记录请求与等待期限，并固定返回给定结果 */
function makeBroker(decision: AiPermissionDecision): {
    channel: AiPermissionChannel
    requests: AiPermissionRequest[]
    timeouts: (number | undefined)[]
} {
    const requests: AiPermissionRequest[] = []
    const timeouts: (number | undefined)[] = []
    return {
        requests,
        timeouts,
        channel: {
            request: (request: AiPermissionRequest, timeoutMs?: number): Promise<AiPermissionDecision> => {
                requests.push(request)
                timeouts.push(timeoutMs)
                return Promise.resolve(decision)
            },
        },
    }
}

describe('只读工具', () => {
    it('读取根内的文件放行', async () => {
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: null })
        const result = await guard('Read', { file_path: path.join(READ_ROOT, 'notes', 'a.md') }, CALL_OPTIONS)
        expect(result.behavior).toBe('allow')
    })

    it('读取根外的文件拒绝但不中断会话', async () => {
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: null })
        const result = await guard('Read', { file_path: OUTSIDE_FILE }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
        if (result.behavior === 'deny') {
            expect(result.interrupt).toBe(false)
        }
    })
})

describe('写入工具', () => {
    it('自动放行时按写入根直接放行', async () => {
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: null })
        const input = { file_path: path.join(WRITE_ROOT, 'Chapters', 'c1.md') }
        const result = await guard('Write', input, CALL_OPTIONS)
        expect(result.behavior).toBe('allow')
        if (result.behavior === 'allow') {
            expect(result.updatedInput).toEqual(input)
        }
    })

    it('逐次确认时先向用户请求，允许后按原入参放行', async () => {
        const broker = makeBroker({ allowed: true })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'ask', broker: broker.channel })
        const input = { file_path: path.join(WRITE_ROOT, 'Chapters', 'c1.md') }
        const result = await guard('Edit', input, CALL_OPTIONS)
        expect(broker.requests).toHaveLength(1)
        expect(broker.requests[0]?.toolName).toBe('Edit')
        expect(result.behavior).toBe('allow')
    })

    it('逐次确认时用户拒绝则中断本轮', async () => {
        const broker = makeBroker({ allowed: false })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'ask', broker: broker.channel })
        const result = await guard('Write', { file_path: path.join(WRITE_ROOT, 'c1.md') }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
        if (result.behavior === 'deny') {
            expect(result.interrupt).toBe(true)
        }
    })

    it('用户改写路径到白名单外时拒绝', async () => {
        const broker = makeBroker({ allowed: true, path: OUTSIDE_FILE })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'ask', broker: broker.channel })
        const result = await guard('Write', { file_path: path.join(WRITE_ROOT, 'c1.md') }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
    })

    it('用户改写路径仍在白名单内时按新路径放行', async () => {
        const nextPath = path.join(WRITE_ROOT, 'Chapters', 'c2.md')
        const broker = makeBroker({ allowed: true, path: nextPath })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'ask', broker: broker.channel })
        const result = await guard('Write', { file_path: path.join(WRITE_ROOT, 'c1.md') }, CALL_OPTIONS)
        expect(result.behavior).toBe('allow')
        if (result.behavior === 'allow') {
            expect(result.updatedInput?.file_path).toBe(nextPath)
        }
    })

    it('没有写入根时拒绝写入', async () => {
        const guard = createToolGuard({ policy: makePolicy({ writeRoots: [] }), approval: 'auto', broker: null })
        const result = await guard('Write', { file_path: path.join(WRITE_ROOT, 'c1.md') }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
    })
})

describe('模型提问', () => {
    const question = {
        question: '这一章用第一人称还是第三人称？',
        header: '视角',
        options: [
            { label: '第一人称', description: '代入感强' },
            { label: '第三人称', description: '视野更宽' },
        ],
        multiSelect: false,
    }

    it('回传答案时并入工具入参', async () => {
        const broker = makeBroker({ allowed: true, answers: { [question.question]: '第一人称' } })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: broker.channel })
        const result = await guard('AskUserQuestion', { questions: [question] }, CALL_OPTIONS)
        expect(broker.requests[0]?.kind).toBe('question')
        expect(result.behavior).toBe('allow')
        if (result.behavior === 'allow') {
            expect(result.updatedInput?.answers).toEqual({ [question.question]: '第一人称' })
        }
    })

    it('等待窗口按题量给：单题三分钟，四题触顶十分钟', async () => {
        const broker = makeBroker({ allowed: true, answers: { [question.question]: '第一人称' } })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: broker.channel })

        await guard('AskUserQuestion', { questions: [question] }, CALL_OPTIONS)
        expect(broker.timeouts[0]).toBe(180_000)

        const fourQuestions = [1, 2, 3, 4].map((index) => ({ ...question, question: `第 ${String(index)} 问` }))
        await guard('AskUserQuestion', { questions: fourQuestions }, CALL_OPTIONS)
        expect(broker.timeouts[1]).toBe(600_000)
    })

    it('没有审批通道时拒绝，避免调用悬空', async () => {
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: null })
        const result = await guard('AskUserQuestion', { questions: [question] }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
    })

    it('问题缺少选项时不发起往返', async () => {
        const broker = makeBroker({ allowed: true })
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: broker.channel })
        const result = await guard('AskUserQuestion', { questions: [{ ...question, options: [] }] }, CALL_OPTIONS)
        expect(broker.requests).toHaveLength(0)
        expect(result.behavior).toBe('deny')
    })
})

describe('白名单外工具', () => {
    it('未开放的工具直接拒绝', async () => {
        const guard = createToolGuard({ policy: makePolicy(), approval: 'auto', broker: null })
        const result = await guard('Bash', { command: 'ls' }, CALL_OPTIONS)
        expect(result.behavior).toBe('deny')
        if (result.behavior === 'deny') {
            expect(result.interrupt).toBe(false)
        }
    })
})
