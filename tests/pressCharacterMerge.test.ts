/**
 * 提取草案合并：覆盖「已存在角色只补空字段」的全部分支——空值补全、已有值不覆盖、
 * 体型同档视为无变化、id 缺失补标识、未匹配的草案新建，以及同名草案不重复建卡。
 * 复用约定：直接调用 webview 侧纯函数，不渲染组件、不发起请求；人物卡一律用 createCharacterCard 建。
 * 关键约束：没有实际变化时必须返回 null，调用方据此跳过写盘，因此「值相同」也算一次断言点。
 */
import { describe, expect, it } from 'vitest'
import type { PressExtractedCharacter } from '@shared/types/press'
import { createCharacterCard, mergeCharacterDraft, mergeCharacterDrafts } from '../src/workflow/press/utils'

/** 草案默认值：各用例只覆盖关心的字段，其余保持模型「没给」的空串形态 */
function createDraft(overrides: Partial<PressExtractedCharacter> = {}): PressExtractedCharacter {
    return {
        name: '陆远',
        alias: '',
        role: '',
        gender: '',
        age: '',
        height: '',
        bodyType: '',
        identity: '',
        appearance: '',
        traits: [],
        background: '',
        desire: '',
        weakness: '',
        catchphrase: '',
        ability: '',
        arc: '',
        relation: '',
        ...overrides,
    }
}

describe('mergeCharacterDraft', () => {
    it('把草案里有值、人物卡里为空的字段补上', () => {
        const card = createCharacterCard({ name: '陆远' })
        const merged = mergeCharacterDraft(
            card,
            createDraft({ height: '一米七八', alias: '陆知县', background: '长流村书生' }),
        )

        expect(merged).not.toBeNull()
        expect(merged?.height).toBe('一米七八')
        expect(merged?.alias).toBe('陆知县')
        expect(merged?.background).toBe('长流村书生')
        expect(merged?.id).toBe(card.id)
    })

    it('不覆盖作者已经写好的字段', () => {
        const card = createCharacterCard({ name: '陆远', height: '一米八零', alias: '侄子' })
        const merged = mergeCharacterDraft(card, createDraft({ height: '一米七八', alias: '陆知县' }))

        expect(merged).toBeNull()
    })

    it('体型同档视为无变化，草案给出别的档位时才补', () => {
        const same = mergeCharacterDraft(createCharacterCard({ name: '陆远' }), createDraft({ bodyType: '匀称' }))
        expect(same).toBeNull()

        const upgraded = mergeCharacterDraft(createCharacterCard({ name: '陆远' }), createDraft({ bodyType: '清瘦' }))
        expect(upgraded?.bodyType).toBe('lean')
    })

    it('人物标识为空时补一个 8 位标识', () => {
        const card = { ...createCharacterCard({ name: '陆远' }), id: '' }
        const merged = mergeCharacterDraft(card, createDraft({ height: '一米七八' }))

        expect(merged?.id).toMatch(/^\d{8}$/u)
    })

    it('未收录的体型标签不写入，保持原档位', () => {
        const merged = mergeCharacterDraft(
            createCharacterCard({ name: '陆远' }),
            createDraft({ bodyType: '瘦得像竹竿' }),
        )

        expect(merged).toBeNull()
    })
})

describe('mergeCharacterDrafts', () => {
    it('同名人物走补全、其余按草案新建，并分别计数', () => {
        const existing = [createCharacterCard({ name: '陆远' })]
        const result = mergeCharacterDrafts(existing, [
            createDraft({ name: '陆远', height: '一米七八' }),
            createDraft({ name: '苏璃烟', role: '主角', gender: '女' }),
        ])

        expect(result.created).toBe(1)
        expect(result.updated).toBe(1)
        expect(result.characters).toHaveLength(2)
        expect(result.characters[0]?.height).toBe('一米七八')
        expect(result.characters[1]?.name).toBe('苏璃烟')
    })

    it('同名草案不会建出第二张卡，后面那条只补先前缺的字段', () => {
        const result = mergeCharacterDrafts(
            [],
            [createDraft({ name: '苏璃烟' }), createDraft({ name: '苏璃烟', height: '一米六八' })],
        )

        expect(result.created).toBe(1)
        expect(result.updated).toBe(1)
        expect(result.characters).toHaveLength(1)
        expect(result.characters[0]?.height).toBe('一米六八')
    })

    it('所有字段都已有值时不产生任何改动', () => {
        const existing = [createCharacterCard({ name: '陆远', height: '一米八零' })]
        const result = mergeCharacterDrafts(existing, [createDraft({ name: '陆远', height: '一米七八' })])

        expect(result.created).toBe(0)
        expect(result.updated).toBe(0)
        expect(result.characters[0]).toBe(existing[0])
    })
})
