/**
 * CliUsageIndex 单元测试：以临时目录伪造 CLI 会话记录，验证积分聚合口径
 * （同一请求 id 多条记录累加、工具调用 credit 计入）、无 credit 视为未知、坏行与缺失目录容错、刷新后读到新值。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CliUsageIndex } from '../../src/modules/ai/cliUsageIndex'

let rootDir: string
let projectDir: string
let index: CliUsageIndex

/** 造一条 CLI 会话记录：credit 与 toolCredit 按需注入 */
function makeRecord(options: {
    type: string
    role?: string
    requestId: string
    credit?: number
    toolCredit?: number
    model?: string
}): string {
    const providerData: Record<string, unknown> = { conversationRequestId: options.requestId }
    if (options.credit !== undefined) {
        providerData.rawUsage = { total_tokens: 100, credit: options.credit }
    }
    if (options.toolCredit !== undefined) {
        providerData.toolResult = { rawResponse: { credit: options.toolCredit } }
    }
    if (options.model !== undefined) {
        providerData.requestModelName = options.model
    }
    return JSON.stringify({
        type: options.type,
        role: options.role,
        timestamp: Date.now(),
        providerData,
    })
}

beforeAll(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-cli-usage-'))
    projectDir = path.join(rootDir, 'd-Git-Projects-demo')
    fs.mkdirSync(projectDir, { recursive: true })
    index = new CliUsageIndex(rootDir)
})

beforeEach(() => {
    for (const name of fs.readdirSync(projectDir)) {
        fs.rmSync(path.join(projectDir, name), { force: true })
    }
})

afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
})

describe('cliUsageIndex', () => {
    it('同一请求 id 的多条记录累加，工具调用也计入', () => {
        fs.writeFileSync(
            path.join(projectDir, 's1.jsonl'),
            [
                makeRecord({ type: 'message', role: 'user', requestId: 'r1' }),
                makeRecord({
                    type: 'message',
                    role: 'assistant',
                    requestId: 'r1',
                    credit: 0.03,
                    model: 'Deepseek-V4.1-Flash',
                }),
                makeRecord({ type: 'function_call_result', requestId: 'r1', toolCredit: 0.5 }),
            ].join('\n'),
            'utf8',
        )
        index.refresh()
        expect(index.readCredit('r1')).toBeCloseTo(0.53)
    })

    it('没有 credit 的轮次视为未知，不返回 0', () => {
        fs.writeFileSync(
            path.join(projectDir, 's2.jsonl'),
            makeRecord({ type: 'message', role: 'assistant', requestId: 'r2' }),
            'utf8',
        )
        index.refresh()
        expect(index.readCredit('r2')).toBeNull()
        expect(index.readCredit(null)).toBeNull()
        expect(index.readCredit('missing')).toBeNull()
    })

    it('坏行与缺失目录不影响其余记录', () => {
        fs.writeFileSync(
            path.join(projectDir, 's3.jsonl'),
            ['not-json', makeRecord({ type: 'message', role: 'assistant', requestId: 'r3', credit: 1.2 })].join('\n'),
            'utf8',
        )
        index.refresh()
        expect(index.readCredit('r3')).toBeCloseTo(1.2)

        const empty = new CliUsageIndex(path.join(rootDir, 'missing'))
        empty.refresh()
        expect(empty.readCredit('r3')).toBeNull()
    })

    it('记录新增后再次刷新可读到新值', () => {
        const file = path.join(projectDir, 's4.jsonl')
        fs.writeFileSync(file, makeRecord({ type: 'message', role: 'assistant', requestId: 'r4', credit: 0.2 }), 'utf8')
        index.refresh()
        expect(index.readCredit('r4')).toBeCloseTo(0.2)

        fs.appendFileSync(file, `\n${makeRecord({ type: 'function_call_result', requestId: 'r4', toolCredit: 0.3 })}`)
        index.refresh()
        expect(index.readCredit('r4')).toBeCloseTo(0.5)
    })
})
