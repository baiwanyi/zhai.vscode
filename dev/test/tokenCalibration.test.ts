/**
 * 字符/token 比值校准测试：验证样本门槛、按模型隔离与越界回落。
 * 复用约定：内存库 + 真实 DDL（ensureAiSchema），不 mock 任何一层，保证 SQL 口径与生产一致。
 * 关键约束：样本不足必须回落默认值 —— 校准值会直接放大或缩小历史裁剪预算，不能凭几行数据就改编。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureAiSchema } from '../../src/modules/ai/db/schema'
import { DEFAULT_CHARS_PER_TOKEN, insertUsageLog, readCharsPerToken } from '../../src/modules/ai/db/usageRepository'

let db: Database.Database

/** 写一行用量：只关心模型、prompt 字数与 prompt tokens，其余列填 0 */
function seed(model: string, index: number, promptChars: number, promptTokens: number): void {
    insertUsageLog(db, {
        id: `u-${model}-${String(index)}`,
        conversationId: null,
        module: 'chat',
        model,
        requestId: `req-${model}-${String(index)}`,
        sdkMessageId: null,
        promptTokens,
        promptChars,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: promptTokens,
        credits: null,
        costUsd: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        latencyMs: 0,
        status: 'completed',
        createdAt: new Date(2026, 9, 29, 0, 0, index).toISOString(),
    })
}

beforeEach(() => {
    db = new Database(':memory:')
    ensureAiSchema(db)
})

describe('readCharsPerToken', () => {
    it('样本不足时回落默认比值', () => {
        for (let index = 0; index < 5; index += 1) {
            seed('m1', index, 160, 100)
        }
        expect(readCharsPerToken(db, 'm1')).toBe(DEFAULT_CHARS_PER_TOKEN)
    })

    it('样本充足时按总量反算字符/token', () => {
        for (let index = 0; index < 20; index += 1) {
            seed('m1', index, 160, 100)
        }
        expect(readCharsPerToken(db, 'm1')).toBeCloseTo(1.6, 5)
    })

    it('按模型分别统计，其他模型的样本不计入', () => {
        for (let index = 0; index < 20; index += 1) {
            seed('m1', index, 100, 100)
        }
        for (let index = 0; index < 20; index += 1) {
            seed('m2', index, 400, 100)
        }
        expect(readCharsPerToken(db, 'm1')).toBeCloseTo(1, 5)
        expect(readCharsPerToken(db, 'm2')).toBeCloseTo(4, 5)
    })

    it('比值越界时回落默认值', () => {
        // 20 字/token 远超合理区间，视为数据异常（跨模型混记或单位写错）
        for (let index = 0; index < 20; index += 1) {
            seed('m1', index, 2000, 100)
        }
        expect(readCharsPerToken(db, 'm1')).toBe(DEFAULT_CHARS_PER_TOKEN)
    })
})
