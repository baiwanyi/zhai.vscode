/**
 * AiUsageService 单元测试：以临时目录上的真实 SQLite 库验证模块/时间筛选、分页夹紧、汇总口径、
 * 历史模块取值归一与提示词按需读取（含非法请求 id 拒绝），基座与生产同为 openAiDatabase。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createUri } from './stubs/vscode'
import type Database from 'better-sqlite3'
import { CliUsageIndex } from '../src/modules/ai/cliUsageIndex'
import { openAiDatabase } from '../src/modules/ai/db/connection'
import { ensureAiSchema } from '../src/modules/ai/db/schema'
import { insertUsageLog, upsertPrompt } from '../src/modules/ai/db/usageRepository'
import { AiUsageService } from '../src/modules/ai/usageService'

const DAY_MS = 24 * 60 * 60 * 1000

let db: Database.Database
let service: AiUsageService
let tempDir: string
let cliRoot: string

/** 造一条用量：模块、时间与请求 id 由用例决定，积分默认为待回填的空值 */
function seedUsage(
    id: string,
    module: string,
    createdAt: string,
    requestId: string,
    credits: number | null = 0.5,
): void {
    insertUsageLog(db, {
        id,
        conversationId: null,
        module,
        model: 'deepseek-chat',
        requestId,
        sdkMessageId: null,
        promptTokens: 10,
        completionTokens: 10,
        reasoningTokens: 0,
        totalTokens: 20,
        credits,
        costUsd: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        latencyMs: 120,
        status: 'completed',
        createdAt,
    })
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-ai-usage-'))
    cliRoot = path.join(tempDir, 'cli-projects')
    fs.mkdirSync(cliRoot, { recursive: true })
    db = openAiDatabase(createUri(tempDir))
    ensureAiSchema(db)
    service = new AiUsageService(db, new CliUsageIndex(cliRoot))
})

beforeEach(() => {
    db.prepare('DELETE FROM ai_usage_logs').run()
    db.prepare('DELETE FROM ai_prompts').run()
    // 每条用例换新索引：绕开 5s 节流，保证新写入的 CLI 记录能被读到
    for (const name of fs.readdirSync(cliRoot)) {
        fs.rmSync(path.join(cliRoot, name), { recursive: true, force: true })
    }
    service = new AiUsageService(db, new CliUsageIndex(cliRoot))
})

afterAll(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('aiUsageService', () => {
    it('按模块筛选并归一历史取值', () => {
        seedUsage('u1', 'chat', new Date().toISOString(), 'req-1')
        seedUsage('u2', 'naming', new Date().toISOString(), 'req-2')
        seedUsage('u3', 'ai-chat', new Date().toISOString(), 'req-3')

        const all = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(all.total).toBe(3)
        expect(all.items.filter((item) => item.module === 'chat')).toHaveLength(2)

        const naming = service.list({ module: 'naming', range: 'all', page: 1, pageSize: 20 })
        expect(naming.total).toBe(1)
        expect(naming.items[0]?.requestId).toBe('req-2')
    })

    it('时间范围只返回范围内的记录', () => {
        const old = new Date(Date.now() - 40 * DAY_MS).toISOString()
        seedUsage('u1', 'chat', new Date().toISOString(), 'req-1')
        seedUsage('u2', 'chat', old, 'req-2')

        expect(service.list({ module: null, range: 'today', page: 1, pageSize: 20 }).total).toBe(1)
        expect(service.list({ module: null, range: '30d', page: 1, pageSize: 20 }).total).toBe(1)
        expect(service.list({ module: null, range: 'all', page: 1, pageSize: 20 }).total).toBe(2)
    })

    it('分页参数被夹紧且汇总与筛选一致', () => {
        seedUsage('u1', 'chat', new Date().toISOString(), 'req-1')
        seedUsage('u2', 'chat', new Date().toISOString(), 'req-2')

        const result = service.list({ module: null, range: 'all', page: 0, pageSize: 999 })
        expect(result.page).toBe(1)
        expect(result.pageSize).toBe(50)
        expect(result.items).toHaveLength(2)
        expect(result.summary.requests).toBe(2)
        expect(result.summary.credits).toBeCloseTo(1)
        expect(result.summary.tokens).toBe(40)
    })

    it('页头的今日与本月积分跟随模块筛选，不受列表时间范围影响', () => {
        const now = new Date()
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()
        seedUsage('u1', 'image', now.toISOString(), 'req-1', 1)
        seedUsage('u2', 'chat', now.toISOString(), 'req-2', 4)
        seedUsage('u3', 'image', lastMonth, 'req-3', 10)

        const todayOnly = service.list({ module: null, range: 'today', page: 1, pageSize: 20 })
        expect(todayOnly.summary.credits).toBeCloseTo(5)
        expect(todayOnly.periods.today).toBeCloseTo(5)
        expect(todayOnly.periods.month).toBeCloseTo(5)

        // 时间范围切到全部只影响汇总与列表，两个周期卡片仍是今日 / 本月口径
        const allRange = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(allRange.summary.credits).toBeCloseTo(15)
        expect(allRange.periods.today).toBeCloseTo(5)
        expect(allRange.periods.month).toBeCloseTo(5)

        // 模块筛选对周期卡片同样生效
        const imageOnly = service.list({ module: 'image', range: 'all', page: 1, pageSize: 20 })
        expect(imageOnly.periods.today).toBeCloseTo(1)
        expect(imageOnly.periods.month).toBeCloseTo(1)
    })

    it('提示词缺失时返回 found=false，存在时按请求 id 取回', () => {
        upsertPrompt(db, {
            requestId: 'req-1',
            content: '【user】你好',
            isTruncated: false,
            createdAt: new Date().toISOString(),
        })

        expect(service.readPrompt('req-1')).toEqual({
            requestId: 'req-1',
            content: '【user】你好',
            isTruncated: false,
            found: true,
        })
        expect(service.readPrompt('req-missing').found).toBe(false)
    })

    it('积分从 CLI 会话记录回填，缺失的保持未知', () => {
        const projectDir = path.join(cliRoot, 'demo')
        fs.mkdirSync(projectDir, { recursive: true })
        fs.writeFileSync(
            path.join(projectDir, 's1.jsonl'),
            [
                JSON.stringify({
                    type: 'message',
                    role: 'assistant',
                    providerData: { conversationRequestId: 'req-cli', rawUsage: { total_tokens: 20, credit: 1.5 } },
                }),
                JSON.stringify({
                    type: 'function_call_result',
                    providerData: { conversationRequestId: 'req-cli', toolResult: { rawResponse: { credit: 0.25 } } },
                }),
            ].join('\n'),
            'utf8',
        )
        seedUsage('u1', 'chat', new Date().toISOString(), 'req-cli', null)
        seedUsage('u2', 'chat', new Date().toISOString(), 'req-missing', null)

        const result = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        const byRequestId = new Map(result.items.map((item) => [item.requestId, item]))
        expect(byRequestId.get('req-cli')?.credits).toBeCloseTo(1.75)
        expect(byRequestId.get('req-missing')?.credits).toBeNull()
        expect(result.summary.credits).toBeCloseTo(1.75)
    })

    it('CLI 记录中本地没有对应行的轮次标为未归属', () => {
        const projectDir = path.join(cliRoot, 'external')
        fs.mkdirSync(projectDir, { recursive: true })
        const timestamp = Date.now()
        fs.writeFileSync(
            path.join(projectDir, 's1.jsonl'),
            [
                JSON.stringify({
                    type: 'message',
                    timestamp,
                    providerData: {
                        conversationRequestId: 'req-ext',
                        model: 'deepseek-chat',
                        rawUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, credit: 2.5 },
                    },
                }),
                JSON.stringify({
                    type: 'function_call_result',
                    timestamp,
                    providerData: { conversationRequestId: 'req-ext', toolResult: { rawResponse: { credit: 3.5 } } },
                }),
            ].join('\n'),
            'utf8',
        )

        const result = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(result.total).toBe(1)
        expect(result.items[0]?.module).toBe('external')
        expect(result.items[0]?.requestId).toBe('req-ext')
        expect(result.items[0]?.model).toBe('deepseek-chat')
        expect(result.items[0]?.totalTokens).toBe(15)
        // 消息积分与工具积分累加，时间取记录里的毫秒时间戳
        expect(result.items[0]?.credits).toBeCloseTo(6)
        expect(result.periods.today).toBeCloseTo(6)

        expect(service.list({ module: 'external', range: 'all', page: 1, pageSize: 20 }).total).toBe(1)
        expect(service.list({ module: 'chat', range: 'all', page: 1, pageSize: 20 }).total).toBe(0)
    })

    it('已回填的积分按 CLI 记录修正，工具调用晚落盘时不会停在部分值', () => {
        const projectDir = path.join(cliRoot, 'partial')
        fs.mkdirSync(projectDir, { recursive: true })
        const file = path.join(projectDir, 's1.jsonl')
        fs.writeFileSync(
            file,
            JSON.stringify({
                type: 'message',
                role: 'assistant',
                providerData: { conversationRequestId: 'req-partial', rawUsage: { credit: 0.5 } },
            }),
            'utf8',
        )
        seedUsage('u1', 'image', new Date().toISOString(), 'req-partial', null)

        const first = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(first.items[0]?.module).toBe('image')
        expect(first.items[0]?.credits).toBeCloseTo(0.5)

        // 出图工具积分晚落盘：库里已回填的 0.5 必须被修正为累计值，而不是永久停在部分值
        fs.appendFileSync(
            file,
            `\n${JSON.stringify({
                type: 'function_call_result',
                providerData: { conversationRequestId: 'req-partial', toolResult: { rawResponse: { credit: 5.3 } } },
            })}`,
            'utf8',
        )

        const updated = service.list({ module: null, range: 'all', page: 1, pageSize: 20, force: true })
        expect(updated.items[0]?.credits).toBeCloseTo(5.8)
        expect(updated.summary.credits).toBeCloseTo(5.8)
        // 本地缓存的积分同样被修正，CLI 记录被清理后才不会退回到部分值
        const cached = db.prepare("SELECT credits FROM ai_usage_logs WHERE id = 'u1'").get() as {
            credits: number | null
        }
        expect(cached.credits).toBeCloseTo(5.8)
    })

    it('force 跳过节流，能立即读到新写入的 CLI 记录', () => {
        seedUsage('u1', 'chat', new Date().toISOString(), 'req-force', null)
        const first = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(first.items[0]?.credits).toBeNull()

        const projectDir = path.join(cliRoot, 'force')
        fs.mkdirSync(projectDir, { recursive: true })
        fs.writeFileSync(
            path.join(projectDir, 's1.jsonl'),
            JSON.stringify({
                type: 'message',
                role: 'assistant',
                providerData: { conversationRequestId: 'req-force', rawUsage: { credit: 0.4 } },
            }),
            'utf8',
        )

        // 5 秒节流内普通查询不会重扫，积分仍为空
        const throttled = service.list({ module: null, range: 'all', page: 1, pageSize: 20 })
        expect(throttled.items[0]?.credits).toBeNull()

        const forced = service.list({ module: null, range: 'all', page: 1, pageSize: 20, force: true })
        expect(forced.items[0]?.credits).toBeCloseTo(0.4)
    })

    it('非法请求 id 直接拒绝', () => {
        expect(() => service.readPrompt('has space')).toThrow()
        expect(() => service.readPrompt('a'.repeat(65))).toThrow()
        expect(() => service.readPrompt('')).toThrow()
    })
})
