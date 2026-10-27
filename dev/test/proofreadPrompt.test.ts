/**
 * AI 校对提示词层单元测试：覆盖分批切分与模型输出的逐项校验，
 * 重点验证「偏移一律由原文回查换算」这条约束——quote 对不上原文、类别非法、片段过短都必须丢弃。
 */
import { describe, expect, it } from 'vitest'
import type { ProofreadBatch } from '../../src/modules/proofread/ai/proofreadPrompt'
import { parseProofreadResponse, splitProofreadBatches } from '../../src/modules/proofread/ai/proofreadPrompt'

/** 构造单批：整段文本作为第一批 */
function makeBatch(text: string, start = 0): ProofreadBatch {
    return { text, start }
}

/** 构造模型输出 */
function buildContent(items: unknown[]): string {
    return JSON.stringify({ items })
}

describe('splitProofreadBatches', () => {
    it('超长文本切分后偏移连续且覆盖全文', () => {
        const text = `${'甲'.repeat(1200)}\n${'乙'.repeat(1200)}`
        const batches = splitProofreadBatches(text, 1200)
        expect(batches.length).toBe(2)
        expect(batches[0]?.start).toBe(0)
        const firstLength = batches[0]?.text.length ?? 0
        expect(batches[1]?.start).toBe(firstLength)
        expect((batches[1]?.start ?? 0) + (batches[1]?.text.length ?? 0)).toBe(text.length)
    })

    it('优先在换行处断开', () => {
        const text = `${'甲'.repeat(700)}\n${'乙'.repeat(700)}`
        const batches = splitProofreadBatches(text, 1200)
        expect(batches[0]?.text.endsWith('\n')).toBe(true)
    })

    it('短文本只产生一批', () => {
        expect(splitProofreadBatches('他走了过去', 1200)).toHaveLength(1)
    })

    it('纯空白文本不产生批次', () => {
        expect(splitProofreadBatches('   \n\n  ', 1200)).toHaveLength(0)
    })
})

describe('parseProofreadResponse 合法输出', () => {
    const text = '第一段内容。他走了过去,然后停下。'
    const batch = makeBatch(text)

    it('按原文回查换算偏移并给出完整字段', () => {
        const quote = '他走了过去,然后停下'
        const result = parseProofreadResponse(
            buildContent([{ kind: 'sentence', quote, suggestion: '改成逗号', reason: '标点混用' }]),
            batch,
            text,
        )
        expect(result.dropped).toBe(0)
        expect(result.issues).toHaveLength(1)
        const issue = result.issues[0]
        expect(issue?.start).toBe(text.indexOf(quote))
        expect(issue?.end).toBe(text.indexOf(quote) + quote.length)
        expect(issue?.category).toBe('sentence')
        expect(issue?.severity).toBe('medium')
        expect(issue?.replacement).toBeNull()
        expect(issue?.source).toBe('ai')
        expect(issue?.reason).toContain('建议：改成逗号')
    })

    it('批次偏移会叠加到全文偏移上', () => {
        const quote = '他走了过去'
        const result = parseProofreadResponse(
            buildContent([{ kind: 'sentence', quote, reason: '语序混乱' }]),
            makeBatch(`前缀${quote}`, 500),
            `前缀${quote}`,
        )
        expect(result.issues[0]?.start).toBe(502)
    })

    it('风险段落为 high 且不带替换文本', () => {
        const result = parseProofreadResponse(
            buildContent([{ kind: 'risk', quote: '他走了过去,然后停下', reason: '涉及真实人物影射' }]),
            batch,
            text,
        )
        expect(result.issues[0]?.category).toBe('risk')
        expect(result.issues[0]?.severity).toBe('high')
        expect(result.issues[0]?.replacement).toBeNull()
    })

    it('理由为空时回落固定文案', () => {
        const result = parseProofreadResponse(buildContent([{ kind: 'sentence', quote: '他走了过去' }]), batch, text)
        expect(result.issues[0]?.reason).toBe('疑似病句，请人工确认')
    })

    it('容忍代码围栏与前后解释', () => {
        const content = `好的，结果如下：\n\`\`\`json\n${buildContent([
            { kind: 'sentence', quote: '他走了过去', reason: '成分残缺' },
        ])}\n\`\`\`\n以上。`
        const result = parseProofreadResponse(content, batch, text)
        expect(result.issues).toHaveLength(1)
    })

    it('裸数组输出同样可解析', () => {
        const content = JSON.stringify([{ kind: 'sentence', quote: '他走了过去', reason: '成分残缺' }])
        const result = parseProofreadResponse(content, batch, text)
        expect(result.issues).toHaveLength(1)
    })
})

describe('parseProofreadResponse 非法输出', () => {
    const text = '第一段内容。他走了过去,然后停下。'
    const batch = makeBatch(text)

    it('quote 未在原文出现时丢弃', () => {
        const result = parseProofreadResponse(
            buildContent([{ kind: 'sentence', quote: '这句话原文里没有', reason: '成分残缺' }]),
            batch,
            text,
        )
        expect(result.issues).toHaveLength(0)
        expect(result.dropped).toBe(1)
    })

    it('类别非法时丢弃', () => {
        const result = parseProofreadResponse(
            buildContent([{ kind: 'typo', quote: '他走了过去', reason: '错别字' }]),
            batch,
            text,
        )
        expect(result.issues).toHaveLength(0)
        expect(result.dropped).toBe(1)
    })

    it('片段过短时丢弃', () => {
        const result = parseProofreadResponse(
            buildContent([{ kind: 'sentence', quote: '他走', reason: '成分残缺' }]),
            batch,
            text,
        )
        expect(result.issues).toHaveLength(0)
        expect(result.dropped).toBe(1)
    })

    it('同一区间重复报告只保留一条', () => {
        const item = { kind: 'sentence', quote: '他走了过去', reason: '成分残缺' }
        const result = parseProofreadResponse(buildContent([item, item]), batch, text)
        expect(result.issues).toHaveLength(1)
        expect(result.dropped).toBe(1)
    })

    it('非 JSON 输出返回空结果', () => {
        const result = parseProofreadResponse('这段文字没有病句。', batch, text)
        expect(result.issues).toHaveLength(0)
        expect(result.dropped).toBe(0)
    })

    it('items 非数组时返回空结果', () => {
        const result = parseProofreadResponse('{"items":"无"}', batch, text)
        expect(result.issues).toHaveLength(0)
    })
})
