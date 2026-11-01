/**
 * 取名生成器单元测试：覆盖人物（中国 / 西方 / 复姓）、实体（地点 / 招式）的组合规则，
 * 以及指定后缀、跨批次去重、种子复现与入参归一化等关键约束。
 */
import { describe, expect, it } from 'vitest'
import type { NamingRequest } from '@shared/types/naming'
import { generateNames } from '../src/modules/naming/generator'
import { normalizeNamingRequest } from '../src/modules/naming/request'

function createRequest(overrides: Partial<NamingRequest> = {}): NamingRequest {
    return {
        category: 'person',
        source: 'local',
        variant: 'cn',
        era: 'modern',
        reference: 'none',
        gender: 'male',
        length: 'two',
        surnameKind: 'single',
        surname: '',
        suffix: '',
        requirement: '',
        count: 12,
        ...overrides,
    }
}

describe('generateNames 人物', () => {
    it('中国双字名：姓氏 + 两个字，且批次内不重复', () => {
        const items = generateNames({ request: createRequest(), seed: 1 })
        expect(items).toHaveLength(12)
        for (const item of items) {
            expect(item.surname).not.toBeNull()
            expect(item.name.length).toBe((item.surname ?? '').length + 2)
        }
        expect(new Set(items.map((item) => item.name)).size).toBe(12)
        expect(new Set(items.map((item) => item.id)).size).toBe(12)
    })

    it('指定复姓时全部以该复姓开头', () => {
        const items = generateNames({
            request: createRequest({ surnameKind: 'compound', surname: '欧阳' }),
            seed: 2,
        })
        for (const item of items) {
            expect(item.name.startsWith('欧阳')).toBe(true)
            expect(item.surname).toBe('欧阳')
        }
    })

    it('西方姓名采用「名 姓」顺序', () => {
        const items = generateNames({ request: createRequest({ variant: 'west', surname: '' }), seed: 3 })
        for (const item of items) {
            const surname = item.surname ?? ''
            expect(surname.length).toBeGreaterThan(0)
            expect(item.name.endsWith(` ${surname}`)).toBe(true)
            expect(item.name).toContain(' ')
        }
    })
})

describe('generateNames 实体', () => {
    it('地点东方指定后缀时全部结尾一致', () => {
        const items = generateNames({
            request: createRequest({ category: 'place', variant: 'east', suffix: '宫' }),
            seed: 4,
        })
        expect(items).toHaveLength(12)
        for (const item of items) {
            expect(item.name.endsWith('宫')).toBe(true)
            expect(item.name.length).toBeLessThanOrEqual(7)
            expect(item.suffix).toBe('宫')
        }
    })

    it('招式未指定后缀时使用池内后缀并保证名称不超过上限', () => {
        const items = generateNames({
            request: createRequest({ category: 'move', variant: 'wuxia', suffix: '' }),
            seed: 5,
        })
        for (const item of items) {
            expect(item.suffix).not.toBeNull()
            expect(item.name.endsWith(item.suffix ?? '')).toBe(true)
            expect(item.name.length).toBeLessThanOrEqual(8)
        }
    })

    it('exclude 中的名字不会再次出现', () => {
        const first = generateNames({ request: createRequest({ category: 'faction', variant: 'east' }), seed: 6 })
        const excluded = first.map((item) => item.name)
        const second = generateNames({
            request: createRequest({ category: 'faction', variant: 'east' }),
            seed: 7,
            exclude: excluded,
        })
        for (const item of second) {
            expect(excluded.includes(item.name)).toBe(false)
        }
    })
})

describe('generateNames 随机源', () => {
    it('相同种子产生相同结果', () => {
        const request = createRequest({ category: 'monster', variant: 'east' })
        const first = generateNames({ request, seed: 42 })
        const second = generateNames({ request, seed: 42 })
        expect(second).toEqual(first)
    })
})

describe('normalizeNamingRequest', () => {
    it('非法分类与数量回落默认值', () => {
        const request = normalizeNamingRequest({ category: 'unknown', count: 999 })
        expect(request.category).toBe('person')
        expect(request.count).toBe(24)
        expect(request.source).toBe('local')
    })

    it('具体要求与后缀按上限截断', () => {
        const request = normalizeNamingRequest({
            category: 'place',
            requirement: '山'.repeat(200),
            suffix: '宫观府关城',
            surname: '李',
        })
        expect(request.requirement).toHaveLength(150)
        expect(request.suffix).toBe('宫观府关')
    })

    it('人物变体非法时回落到该分类首项', () => {
        const request = normalizeNamingRequest({ category: 'person', variant: 'mars' })
        expect(request.variant).toBe('cn')
    })
})
