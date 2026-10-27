/**
 * 词库 md 的单测：覆盖三级标题解析、正文多行合并、缺层级跳过、序列化幂等与标识拆分。
 * 关注点：四级标题不能当成词条名；空正文的块被丢弃；读改写后形态稳定；
 * 标识段数不对或含空段时直接判非法，避免用坏标识去定位 md。
 */
import { describe, expect, it } from 'vitest'
import { parseTagId, parseTagMarkdown, serializeTagMarkdown, tagIdOf } from '../../src/modules/imagegen/prompt'

describe('词库 md 解析', () => {
    it('按三级标题归组，正文取标题下的非空行', () => {
        const entries = parseTagMarkdown('# 人物\n\n## 基础\n\n### 女性\nfemale\n\n### 男性\nmale\n')

        expect(entries).toEqual([
            { object: '人物', attribute: '基础', name: '女性', prompt: 'female' },
            { object: '人物', attribute: '基础', name: '男性', prompt: 'male' },
        ])
    })

    it('正文多行按空格合并为一行', () => {
        const [entry] = parseTagMarkdown('# 人物\n## 基础\n### 女性\nfemale\nyoung\n')

        expect(entry?.prompt).toBe('female young')
    })

    it('缺分组或正文为空的块被丢弃', () => {
        expect(parseTagMarkdown('# 人物\n\n### 女性\nfemale\n')).toEqual([])
        expect(parseTagMarkdown('# 人物\n## 基础\n### 女性\n\n')).toEqual([])
    })

    it('四级标题不当词条名，按正文保留', () => {
        const [entry] = parseTagMarkdown('# 人物\n## 基础\n### 女性\n#### 备注\nfemale\n')

        expect(entry?.name).toBe('女性')
        expect(entry?.prompt).toBe('#### 备注 female')
    })

    it('首个标题之前的内容被忽略', () => {
        expect(parseTagMarkdown('随手写的备注\n# 人物\n## 基础\n### 女性\nfemale\n')).toEqual([
            { object: '人物', attribute: '基础', name: '女性', prompt: 'female' },
        ])
    })

    it('正文行首的 \\# 还原为字面量，不被当成标题', () => {
        const [entry] = parseTagMarkdown('# 人物\n## 基础\n### 女性\n\\# 标题\nfemale\n')

        expect(entry?.name).toBe('女性')
        expect(entry?.prompt).toBe('# 标题 female')
    })
})

describe('词库 md 序列化', () => {
    it('同组条目归拢，分组按首次出现顺序输出', () => {
        const text = serializeTagMarkdown('人物', [
            { object: '人物', attribute: '基础', name: '女性', prompt: 'female' },
            { object: '人物', attribute: '身份', name: '救生员', prompt: 'lifeguard' },
            { object: '人物', attribute: '基础', name: '男性', prompt: 'male' },
        ])

        expect(text).toBe(
            [
                '# 人物',
                '',
                '## 基础',
                '',
                '### 女性',
                'female',
                '',
                '### 男性',
                'male',
                '',
                '## 身份',
                '',
                '### 救生员',
                'lifeguard',
                '',
            ].join('\n'),
        )
    })

    it('读改写幂等：反复序列化不再产生行变更', () => {
        const entries = [
            { object: '人物', attribute: '基础', name: '女性', prompt: 'female' },
            { object: '人物', attribute: '身份', name: '救生员', prompt: 'lifeguard' },
        ]
        const once = serializeTagMarkdown('人物', entries)

        expect(serializeTagMarkdown('人物', parseTagMarkdown(once))).toBe(once)
    })

    it('空条目只留分类标题', () => {
        expect(serializeTagMarkdown('人物', [])).toBe('# 人物\n')
    })

    it('正文行首 # 自动转义，往返不丢内容', () => {
        const entries = [{ object: '人物', attribute: '基础', name: '女性', prompt: '# 标题 female' }]
        const text = serializeTagMarkdown('人物', entries)

        expect(text).toContain('\\# 标题 female')
        expect(parseTagMarkdown(text)).toEqual(entries)
    })
})

describe('词条标识', () => {
    it('三段拼接与拆分互为逆运算', () => {
        const id = tagIdOf('人物', '基础', '女性')

        expect(id).toBe('人物::基础::女性')
        expect(parseTagId(id)).toEqual({ object: '人物', attribute: '基础', name: '女性' })
    })

    it('段数不足或含空段时判非法', () => {
        expect(parseTagId('人物::基础')).toBeNull()
        expect(parseTagId('人物::::女性')).toBeNull()
        expect(parseTagId('::基础::女性')).toBeNull()
    })
})
