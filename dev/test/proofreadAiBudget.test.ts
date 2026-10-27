/**
 * AI 校对预算单测：验证整体预算耗尽后停止提交新批次并计入 skippedBatches。
 * 复用约定：假通道只实现 AiProvider 的三个成员，不接触真实通道、凭证与数据库。
 * 关键约束：预算判断发生在每批开始之前，所以预算极小时通道一次都不应被调用；
 * 取消仍然优先于预算，已取消时直接抛出而不返回部分结果。
 */
import { describe, expect, it } from 'vitest'
import type { ProofreadTarget } from '@shared/types/proofread'
import type { AiProvider, AiStreamChunk } from '../../src/modules/ai/provider'
import { runAiProofread } from '../../src/modules/proofread/ai/aiProofreader'

/** 造一个能记录调用次数的假通道 */
function createProvider(): { provider: AiProvider; calls: () => number } {
    let calls = 0
    const provider: AiProvider = {
        id: 'codebuddy',
        checkReady: () => Promise.resolve({ ready: true }),
        stream: async function* (): AsyncGenerator<AiStreamChunk> {
            calls += 1
            // 显式让出一次，与真实通道的异步边界保持一致
            await Promise.resolve()
            yield { content: '{"items":[]}', reasoning: '' }
        },
    }
    return { provider, calls: () => calls }
}

/** 造一份足以切成两批的目标正文 */
function createTarget(): ProofreadTarget {
    return {
        kind: 'document',
        path: 'press/剑来/Chapters/01-初见.md',
        title: '01-初见',
        text: '他站在山门前。'.repeat(50),
        wordCount: 350,
        offsetBase: 0,
        version: 1,
        mtime: '2026-10-25T00:00:00.000Z',
        truncated: false,
    }
}

describe('runAiProofread 时间预算', () => {
    it('预算耗尽时不再提交批次并计入 skipped', async () => {
        const { provider, calls } = createProvider()
        const outcome = await runAiProofread({
            provider,
            model: 'test-model',
            target: createTarget(),
            batchChars: 200,
            signal: new AbortController().signal,
            budgetMs: 0,
        })

        expect(outcome.batches).toBeGreaterThan(1)
        expect(outcome.skippedBatches).toBe(outcome.batches)
        expect(outcome.failedBatches).toBe(0)
        expect(outcome.issues).toEqual([])
        expect(outcome.usage).toBeNull()
        expect(calls()).toBe(0)
    })

    it('默认预算下逐批执行且不产生 skipped', async () => {
        const { provider, calls } = createProvider()
        const outcome = await runAiProofread({
            provider,
            model: 'test-model',
            target: createTarget(),
            batchChars: 200,
            signal: new AbortController().signal,
        })

        expect(outcome.batches).toBeGreaterThan(1)
        expect(outcome.skippedBatches).toBe(0)
        expect(outcome.failedBatches).toBe(0)
        expect(calls()).toBe(outcome.batches)
    })

    it('已取消时直接抛出，不返回部分结果', async () => {
        const { provider } = createProvider()
        const controller = new AbortController()
        controller.abort()

        await expect(
            runAiProofread({
                provider,
                model: 'test-model',
                target: createTarget(),
                batchChars: 200,
                signal: controller.signal,
            }),
        ).rejects.toThrow('AI 校对已取消')
    })
})
