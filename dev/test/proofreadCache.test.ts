/**
 * 校对缓存单测：覆盖写入读回、结构收窄与签名比对三条主线。
 * 复用约定：内存实现只满足 resultCache 的 CacheState（get / update），不伪造整个 vscode.Memento。
 * 关键约束：结构任一处非法都必须整份作废，避免半份缓存把旧偏移交给界面。
 */
import { describe, expect, it } from 'vitest'
import type { ProofreadAiDetectResult, ProofreadCache, ProofreadIssue, ProofreadTarget } from '@shared/types/proofread'
import type { CacheState } from '../../src/modules/proofread/cache/resultCache'
import {
    isSameTarget,
    readDetectCache,
    readProofreadCache,
    toCachedTarget,
    writeDetectCache,
    writeProofreadCache,
} from '../../src/modules/proofread/cache/resultCache'

const RESULT_CACHE_KEY = 'proofread.resultCache'
const DETECT_CACHE_KEY = 'proofread.detectCache'

/** 内存态 Memento：只实现缓存模块用到的方法 */
function createState(): { store: Map<string, unknown>; state: CacheState } {
    const store = new Map<string, unknown>()
    return {
        store,
        state: {
            get: <T>(key: string): T | undefined => {
                const value = store.get(key)
                return value === undefined ? undefined : (value as T)
            },
            update: (key: string, value: unknown): Promise<void> => {
                store.set(key, value)
                return Promise.resolve()
            },
        },
    }
}

/** 造一份检查目标 */
function createTarget(overrides: Partial<ProofreadTarget> = {}): ProofreadTarget {
    return {
        kind: 'document',
        path: 'press/剑来/Chapters/01-初见.md',
        title: '01-初见',
        text: '他站在山门前，风穿过松林。',
        wordCount: 12,
        offsetBase: 0,
        version: 3,
        mtime: '2026-10-25T00:00:00.000Z',
        truncated: false,
        ...overrides,
    }
}

/** 造一条问题 */
function createIssue(overrides: Partial<ProofreadIssue> = {}): ProofreadIssue {
    return {
        id: 'typo-2-4',
        category: 'typo',
        severity: 'low',
        quote: '山门',
        start: 2,
        end: 4,
        replacement: '山門',
        reason: '繁简混用',
        source: 'local',
        paragraph: 1,
        ...overrides,
    }
}

/** 造一份校对缓存 */
function createCache(target: ProofreadTarget): ProofreadCache {
    return {
        savedAt: '2026-10-25T10:00:00.000Z',
        target: toCachedTarget(target),
        local: { issues: [createIssue()], elapsedMs: 12, suppressed: 1, lexiconEntries: 2 },
        ai: {
            issues: [createIssue({ id: 'sentence-5-8', category: 'sentence', severity: 'medium', replacement: null })],
            path: target.path,
            version: target.version,
            mtime: target.mtime,
            batches: 2,
            failedBatches: 0,
            skippedBatches: 0,
            usageTokens: 30,
        },
    }
}

/** 造一份检测结果 */
function createDetectResult(target: ProofreadTarget): ProofreadAiDetectResult {
    return {
        path: target.path,
        version: target.version,
        humanRatio: 0.8,
        aiRatio: 0.15,
        suspectRatio: 0.05,
        confidence: 0.9,
        ratioConfidence: 0.7,
        segments: [{ paragraph: 2, label: 1, conf: 0.92, start: 5, end: 9, text: '风穿过松林' }],
        usedTokens: 120,
        detectedAt: '2026-10-25T10:05:00.000Z',
    }
}

describe('proofreadCache', () => {
    it('校对缓存写入后可原样读回', async () => {
        const { state } = createState()
        const target = createTarget()
        await writeProofreadCache(state, createCache(target))

        const cached = readProofreadCache(state)
        expect(cached).not.toBeNull()
        expect(cached?.target.path).toBe(target.path)
        expect(cached?.target.chars).toBe(target.text.length)
        expect(cached?.local.issues).toHaveLength(1)
        expect(cached?.ai?.issues).toHaveLength(1)
        expect(cached?.ai?.usageTokens).toBe(30)
    })

    it('问题条目字段非法时整份缓存作废', () => {
        const { store, state } = createState()
        const target = createTarget()
        store.set(RESULT_CACHE_KEY, {
            savedAt: '2026-10-25T10:00:00.000Z',
            target: toCachedTarget(target),
            local: {
                issues: [{ ...createIssue(), category: 'unknown' }],
                elapsedMs: 0,
                suppressed: 0,
                lexiconEntries: 0,
            },
            ai: null,
        })

        expect(readProofreadCache(state)).toBeNull()
    })

    it('偏移出现负数时整份缓存作废', () => {
        const { store, state } = createState()
        const target = createTarget()
        store.set(RESULT_CACHE_KEY, {
            savedAt: '2026-10-25T10:00:00.000Z',
            target: toCachedTarget(target),
            local: { issues: [createIssue({ start: -1 })], elapsedMs: 0, suppressed: 0, lexiconEntries: 0 },
            ai: null,
        })

        expect(readProofreadCache(state)).toBeNull()
    })

    it('正文改动后签名不再匹配', () => {
        const target = createTarget()
        const cached = toCachedTarget(target)

        expect(isSameTarget(cached, target)).toBe(true)
        expect(isSameTarget(cached, createTarget({ text: '他站在山门前，风穿过松林。又起风了。' }))).toBe(false)
        expect(isSameTarget(cached, createTarget({ mtime: '2026-10-26T00:00:00.000Z' }))).toBe(false)
        expect(isSameTarget(cached, createTarget({ kind: 'selection' }))).toBe(false)
    })

    it('检测缓存写入后可读回，标签非法时作废', async () => {
        const { store, state } = createState()
        const target = createTarget()
        await writeDetectCache(state, {
            savedAt: '2026-10-25T10:05:00.000Z',
            target: toCachedTarget(target),
            result: createDetectResult(target),
        })

        const cached = readDetectCache(state)
        expect(cached?.result.segments).toHaveLength(1)
        expect(cached?.result.humanRatio ?? -1).toBeCloseTo(0.8)

        store.set(DETECT_CACHE_KEY, {
            savedAt: '2026-10-25T10:05:00.000Z',
            target: toCachedTarget(target),
            result: {
                ...createDetectResult(target),
                segments: [{ paragraph: 1, label: 3, conf: 0.5, start: 0, end: 1, text: '×' }],
            },
        })
        expect(readDetectCache(state)).toBeNull()
    })
})
