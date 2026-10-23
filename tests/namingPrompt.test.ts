/**
 * AI 取名提示词与解析测试：覆盖围栏 / 裸数组 / 脏文本三种输出形态，以及后缀、姓氏、去重与限量校验。
 */
import { describe, expect, it } from 'vitest'
import type { NamingRequest } from '../src/shared/types/naming'
import { buildNamingMessages, parseNamingResponse } from '../src/modules/naming/ai/namingPrompt'

function createRequest(overrides: Partial<NamingRequest> = {}): NamingRequest {
    return {
        category: 'place',
        source: 'ai',
        variant: 'east',
        era: 'modern',
        reference: 'none',
        gender: 'male',
        length: 'any',
        surnameKind: 'single',
        surname: '',
        suffix: '宫',
        requirement: '靠海',
        count: 3,
        ...overrides,
    }
}

describe('buildNamingMessages', () => {
    it('包含类别、数量与强制后缀约束', () => {
        const [systemMessage, userMessage] = buildNamingMessages(createRequest())
        expect(systemMessage?.role).toBe('system')
        expect(systemMessage?.content).toContain('JSON')
        expect(userMessage?.content).toContain('地点')
        expect(userMessage?.content).toContain('数量：3 个')
        expect(userMessage?.content).toContain('强制后缀：宫')
        expect(userMessage?.content).toContain('靠海')
    })
})

describe('parseNamingResponse', () => {
    it('解析标准 JSON 对象并按后缀过滤', () => {
        const items = parseNamingResponse('{"names":["听潮宫","望海宫","无名镇"]}', createRequest())
        expect(items.map((item) => item.name)).toEqual(['听潮宫', '望海宫'])
        expect(items[0]?.suffix).toBe('宫')
    })

    it('兼容 ```json 围栏与前后解释文字', () => {
        const content = '好的，结果如下：\n```json\n{"names":["落霞宫","寒山宫"]}\n```\n以上。'
        const items = parseNamingResponse(content, createRequest())
        expect(items).toHaveLength(2)
    })

    it('兼容裸数组输出', () => {
        const items = parseNamingResponse('["碧水宫","青崖宫"]', createRequest())
        expect(items.map((item) => item.name)).toEqual(['碧水宫', '青崖宫'])
    })

    it('JSON 解析失败时按引号文本兜底', () => {
        const items = parseNamingResponse('名字有："落霞宫" 与 "无名镇"', createRequest())
        expect(items.map((item) => item.name)).toEqual(['落霞宫'])
    })

    it('过滤去重与超量，保留前 count 个', () => {
        const content = '{"names":["听潮宫","听潮宫","望海宫","落霞宫","寒山宫"]}'
        const items = parseNamingResponse(content, createRequest({ count: 2 }))
        expect(items.map((item) => item.name)).toEqual(['听潮宫', '望海宫'])
    })

    it('人物指定姓氏时剔除不含姓氏的结果', () => {
        const request = createRequest({ category: 'person', variant: 'cn', suffix: '', surname: '沈', count: 3 })
        const items = parseNamingResponse('{"names":["沈砚舟","李清禾","沈清禾"]}', request)
        expect(items.map((item) => item.name)).toEqual(['沈砚舟', '沈清禾'])
        expect(items[0]?.surname).toBe('沈')
    })

    it('完全不合规时返回空数组', () => {
        const items = parseNamingResponse('{"names":["听潮","望海"]}', createRequest())
        expect(items).toEqual([])
    })
})
