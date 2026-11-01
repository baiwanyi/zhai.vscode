/**
 * 朱雀检测结果映射单元测试：覆盖比例归一化、分段位置校验与可疑分段挑选规则，
 * 重点验证「越界分段必须丢弃」「额度只认 makers_models_usage」这两条外部字段收窄约束。
 */
import { describe, expect, it } from 'vitest'
import type { ProofreadTarget } from '@shared/types/proofread'
import type { ZhuqueClassifyResult } from '../src/modules/proofread/detect/zhuqueClient'
import { toDetectResult } from '../src/modules/proofread/detect/aiDetector'
import { mapZhuqueResponse } from '../src/modules/proofread/detect/zhuqueClient'

/** 构造一份成功响应 */
function buildResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        status: 'success',
        softmax_confidence: 0.0019,
        ratio_confidence: 0,
        labels_ratio: { 0: 1, 1: 0, 2: 0 },
        segment_labels: [{ text: 'hello world', label: 0, conf: 0.0019, order: 1, position: [0, 11] }],
        usage: { total_tokens: 50 },
        makers_models_usage: { total_tokens: 30 },
        msg: '',
        ...overrides,
    }
}

describe('mapZhuqueResponse', () => {
    it('归一化三类占比并读取额度', () => {
        const result = mapZhuqueResponse(buildResponse({ labels_ratio: { 0: 48.01, 1: 25.68, 2: 26.31 } }), 11)
        expect(result.usedTokens).toBe(30)
        expect(result.humanRatio).toBeCloseTo(0.4801, 4)
        expect(result.aiRatio).toBeCloseTo(0.2568, 4)
        expect(result.suspectRatio).toBeCloseTo(0.2631, 4)
    })

    it('占比全为 0 时保持 0，不做均分', () => {
        const result = mapZhuqueResponse(buildResponse({ labels_ratio: { 0: 0, 1: 0, 2: 0 } }), 11)
        expect(result.humanRatio).toBe(0)
        expect(result.aiRatio).toBe(0)
        expect(result.suspectRatio).toBe(0)
    })

    it('非 success 状态抛出平台 msg', () => {
        expect(() => mapZhuqueResponse(buildResponse({ status: 'failed', msg: '额度不足' }), 11)).toThrow(
            '朱雀检测失败：额度不足',
        )
    })

    it('响应体不是对象时抛出兜底错误', () => {
        expect(() => mapZhuqueResponse('oops', 11)).toThrow('朱雀检测返回异常')
    })

    it('位置越界的分段被丢弃', () => {
        const result = mapZhuqueResponse(
            buildResponse({
                segment_labels: [{ text: '越界', label: 1, conf: 0.9, order: 2, position: [5, 99] }],
            }),
            11,
        )
        expect(result.segments).toHaveLength(0)
    })

    it('标签非法的分段被丢弃', () => {
        const result = mapZhuqueResponse(
            buildResponse({
                segment_labels: [{ text: 'x', label: 5, conf: 0.9, order: 2, position: [0, 5] }],
            }),
            11,
        )
        expect(result.segments).toHaveLength(0)
    })

    it('缺少 order 时置 0，交由展示层回填', () => {
        const result = mapZhuqueResponse(
            buildResponse({
                segment_labels: [{ text: 'abc', label: 2, conf: 0.42, position: [0, 3] }],
            }),
            11,
        )
        expect(result.segments[0]?.order).toBe(0)
        expect(result.segments[0]?.conf).toBeCloseTo(0.42, 4)
    })
})

describe('toDetectResult', () => {
    const target: ProofreadTarget = {
        kind: 'document',
        path: 'press/测试/Chapters/01.md',
        title: '01',
        text: '一二三四五六',
        wordCount: 6,
        offsetBase: 0,
        version: 7,
        mtime: '2026-10-25T00:00:00.000Z',
        truncated: false,
    }

    /** 构造分类结果 */
    function buildClassify(overrides: Partial<ZhuqueClassifyResult> = {}): ZhuqueClassifyResult {
        return {
            humanRatio: 0.5,
            aiRatio: 0.3,
            suspectRatio: 0.2,
            confidence: 0.6,
            ratioConfidence: 0.4,
            segments: [],
            usedTokens: 12,
            ...overrides,
        }
    }

    it('只保留非人工分段并按置信度降序', () => {
        const result = toDetectResult(
            target,
            buildClassify({
                segments: [
                    { label: 0, conf: 0.99, order: 1, start: 0, end: 2, text: '一二' },
                    { label: 1, conf: 0.4, order: 2, start: 2, end: 4, text: '三四' },
                    { label: 2, conf: 0.8, order: 3, start: 4, end: 6, text: '五六' },
                ],
            }),
        )
        expect(result.segments.map((segment) => segment.label)).toEqual([2, 1])
        expect(result.path).toBe(target.path)
        expect(result.version).toBe(target.version)
    })

    it('可疑分段最多保留 5 条', () => {
        const segments = Array.from({ length: 8 }, (_, index) => ({
            label: 1 as const,
            conf: 0.5 + index / 100,
            order: index + 1,
            start: index,
            end: index + 1,
            text: 'x',
        }))
        const result = toDetectResult(target, buildClassify({ segments }))
        expect(result.segments).toHaveLength(5)
        expect(result.segments[0]?.conf).toBeGreaterThan(result.segments[4]?.conf ?? 0)
    })

    it('缺少 order 时按展示顺序回填段落号', () => {
        const result = toDetectResult(
            target,
            buildClassify({ segments: [{ label: 1, conf: 0.9, order: 0, start: 0, end: 2, text: '一二' }] }),
        )
        expect(result.segments[0]?.paragraph).toBe(1)
    })
})
