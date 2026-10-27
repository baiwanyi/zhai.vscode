/**
 * 本地校对规则单元测试：覆盖标点、重复、内置词表与自定义词库四组规则的命中与替换建议，
 * 以及代码块跳过、忽略词计数、段落号与自定义词条严重度等聚合层约束。
 */
import { describe, expect, it } from 'vitest'
import type { ProofreadLexiconEntry, ProofreadLocalResult } from '@shared/types/proofread'
import { runLocalChecks } from '../../src/modules/proofread/local/localChecker'

/** 只跑规则、不配置词库的快捷入口 */
function check(
    text: string,
    options: { entries?: ProofreadLexiconEntry[]; ignores?: string[] } = {},
): ProofreadLocalResult {
    return runLocalChecks(text, { entries: options.entries ?? [], ignores: options.ignores ?? [] })
}

describe('runLocalChecks 标点', () => {
    it('中文后的半角逗号替换为全角', () => {
        const result = check('他说,明天见')
        const issue = result.issues.find((item) => item.replacement === '，')
        expect(issue).toBeDefined()
        expect(issue?.quote).toBe(',')
        expect(issue?.severity).toBe('low')
    })

    it('英文句子中的半角标点不报', () => {
        const result = check('hello, world! good.')
        expect(result.issues).toHaveLength(0)
    })

    it('连续感叹号只保留一个', () => {
        const result = check('太好了！！！')
        const issue = result.issues.find((item) => item.replacement === '！')
        expect(issue?.quote).toBe('！！！')
    })

    it('英文三点省略号替换为中文省略号', () => {
        const result = check('他想了想...')
        const issue = result.issues.find((item) => item.replacement === '……')
        expect(issue?.quote).toBe('...')
    })

    it('规范写法不误报', () => {
        const result = check('他想了想……然后离开了——没有再回头。')
        expect(result.issues).toHaveLength(0)
    })
})

describe('runLocalChecks 重复', () => {
    it('虚词叠字命中并可替换', () => {
        const result = check('他的的确很好')
        const issue = result.issues.find((item) => item.quote === '的的')
        expect(issue?.replacement).toBe('的')
        expect(issue?.severity).toBe('low')
    })

    it('合法叠词不命中', () => {
        const result = check('爸爸常常带着妈妈渐渐走远')
        expect(result.issues.filter((item) => item.category === 'typo')).toHaveLength(0)
    })

    it('相邻短语重复只提示不替换', () => {
        const result = check('他知道他知道就笑了')
        const issue = result.issues.find((item) => item.quote === '他知道他知道')
        expect(issue?.replacement).toBeNull()
        expect(issue?.severity).toBe('medium')
    })
})

describe('runLocalChecks 内置词表', () => {
    it('命中错别字并给出正确写法', () => {
        const result = check('他按耐不住心中的激动')
        const issue = result.issues.find((item) => item.quote === '按耐不住')
        expect(issue?.replacement).toBe('按捺不住')
        expect(issue?.category).toBe('typo')
    })

    it('同一词条多处出现逐处命中', () => {
        const result = check('既使如此，既使再难也要走')
        expect(result.issues.filter((item) => item.quote === '既使')).toHaveLength(2)
    })
})

describe('runLocalChecks 自定义词库', () => {
    it('replace 词条可一键替换', () => {
        const entries: ProofreadLexiconEntry[] = [{ wrong: '李慕白', right: '李慕柏', mode: 'replace' }]
        const result = check('李慕白抬起头', { entries })
        const issue = result.issues.find((item) => item.category === 'custom')
        expect(issue?.replacement).toBe('李慕柏')
        expect(issue?.severity).toBe('low')
    })

    it('flag 词条只提示不替换', () => {
        const entries: ProofreadLexiconEntry[] = [{ wrong: '缓缓地', right: '缓缓', mode: 'flag' }]
        const result = check('他缓缓地走过来', { entries })
        const issue = result.issues.find((item) => item.category === 'custom')
        expect(issue?.replacement).toBeNull()
        expect(issue?.severity).toBe('medium')
    })

    it('统计参与检查的词条数', () => {
        const entries: ProofreadLexiconEntry[] = [{ wrong: '甲', right: '乙', mode: 'replace' }]
        expect(check('无关内容', { entries }).lexiconEntries).toBe(1)
    })
})

describe('runLocalChecks 聚合', () => {
    it('忽略词命中即跳过并计数', () => {
        const result = check('按耐不住的既使如此', { ignores: ['按耐不住'] })
        expect(result.issues.some((item) => item.quote === '按耐不住')).toBe(false)
        expect(result.suppressed).toBeGreaterThanOrEqual(1)
    })

    it('围栏代码块内不报错', () => {
        const text = ['正文开始', '```', 'console.log(1)!!!', '```', '正文结束'].join('\n')
        const result = check(text)
        expect(result.issues).toHaveLength(0)
    })

    it('行内代码内不报错', () => {
        const result = check('执行 `a,b` 即可')
        expect(result.issues).toHaveLength(0)
    })

    it('按偏移给出 1 基段落号', () => {
        const result = check('第一行\n他说,你好')
        const issue = result.issues.find((item) => item.replacement === '，')
        expect(issue?.paragraph).toBe(2)
    })

    it('结果按偏移升序', () => {
        const result = check('既使如此,他说...')
        const starts = result.issues.map((item) => item.start)
        expect([...starts].sort((left, right) => left - right)).toEqual(starts)
    })
})
