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
import { openAiDatabase } from '../src/modules/ai/db/connection'
import { ensureAiSchema } from '../src/modules/ai/db/schema'
import { insertUsageLog, upsertPrompt } from '../src/modules/ai/db/usageRepository'
import { AiUsageService } from '../src/modules/ai/usageService'

const DAY_MS = 24 * 60 * 60 * 1000

let db: Database.Database
let service: AiUsageService
let tempDir: string

/** 造一条用量：模块、时间与请求 id 由用例决定 */
function seedUsage(id: string, module: string, createdAt: string, requestId: string): void {
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
        credits: 0.5,
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
    db = openAiDatabase(createUri(tempDir))
    ensureAiSchema(db)
    service = new AiUsageService(db)
})

beforeEach(() => {
    db.prepare('DELETE FROM ai_usage_logs').run()
    db.prepare('DELETE FROM ai_prompts').run()
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

    it('非法请求 id 直接拒绝', () => {
        expect(() => service.readPrompt('has space')).toThrow()
        expect(() => service.readPrompt('a'.repeat(65))).toThrow()
        expect(() => service.readPrompt('')).toThrow()
    })
})
