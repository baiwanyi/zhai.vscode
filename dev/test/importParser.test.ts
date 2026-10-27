/**
 * importParser 单元测试：覆盖分章、卷识别、前导内容处置、行首标题转义、默认卷兜底与文件名清洗。
 * 复用 countWords 的真实口径做字数断言，避免测试自造一套统计规则掩盖偏差。
 */
import { describe, expect, it } from 'vitest'
import { countWords } from '../../src/modules/common/db/fileMeta'
import { parseNovel, sanitizeSegment } from '../../src/modules/press/importParser'

describe('parseNovel', () => {
    it('按章节标记切分并保留正文段落', () => {
        const text = ['第一章 开端', '他走了出去。', '', '天很黑。', '第二章 转折', '第二天他回来了。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.title).toBe('第一章 开端')
        expect(parsed.chapters[0]?.body).toBe('他走了出去。\n\n天很黑。')
        expect(parsed.chapters[0]?.charCount).toBe(countWords('他走了出去。天很黑。'))
        expect(parsed.chapters[1]?.order).toBe(2)
        expect(parsed.chapters[1]?.body).toBe('第二天他回来了。')
    })

    it('卷标记改变后续章节落点并生成两位序号目录名', () => {
        const text = ['第一卷 少年', '第一章 开始', '正文一。', '第二卷 归来', '第二章 重逢', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.volumeDirs).toEqual(['01-少年', '02-归来'])
        expect(parsed.chapters[0]?.volumeDir).toBe('01-少年')
        expect(parsed.chapters[1]?.volumeDir).toBe('02-归来')
    })

    it('章节标记之前的短内容丢弃并记入告警', () => {
        const text = ['小说名', '作者：某某', '第一章 开始', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(1)
        expect(parsed.chapters[0]?.title).toBe('第一章 开始')
        expect(parsed.warnings.some((warning) => warning.includes('已跳过'))).toBe(true)
    })

    it('章节标记之前的长内容保留为前言且序号连续', () => {
        const preface = '这是一段很长的前言。'.repeat(30)
        const text = [preface, '第一章 开始', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.title).toBe('前言')
        expect(parsed.chapters[0]?.order).toBe(1)
        expect(parsed.chapters[1]?.order).toBe(2)
        expect(parsed.warnings.some((warning) => warning.includes('前言'))).toBe(true)
    })

    it('正文行首的 # 转全角避免被识别为标题', () => {
        const text = ['第一章 开始', '### 分隔', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters[0]?.body.startsWith('＃## 分隔')).toBe(true)
        expect(parsed.warnings.some((warning) => warning.includes('全角'))).toBe(true)
    })

    it('正文行首的其余 Markdown 块级符号同样转全角', () => {
        const text = [
            '第一章 开始',
            '- 待办一',
            '* 星号',
            '> 引用一句',
            '| 列一 | 列二 |',
            '1) 有序项',
            '---',
            '```',
            '<div>标签</div>',
            '[说明]: https://example.com',
            '正文。',
        ].join('\n')
        const parsed = parseNovel(text)
        const body = parsed.chapters[0]?.body ?? ''
        expect(body).toContain('－ 待办一')
        expect(body).toContain('＊ 星号')
        expect(body).toContain('＞ 引用一句')
        expect(body).toContain('｜ 列一 | 列二 |')
        expect(body).toContain('1） 有序项')
        expect(body).toContain('－--')
        expect(body).toContain('｀``')
        expect(body).toContain('＜div>标签</div>')
        expect(body).toContain('［说明]: https://example.com')
    })

    it('没有章节标记时返回空列表，交由调用方报错', () => {
        const parsed = parseNovel('一段没有任何章节标记的正文。')
        expect(parsed.chapters).toHaveLength(0)
        expect(parsed.totalChars).toBeGreaterThan(0)
    })

    it('总字数等于各章字数与前言字数之和', () => {
        const text = ['第一章 甲', '一二三。', '第二章 乙', '四五六。'].join('\n')
        const parsed = parseNovel(text)
        const sum = parsed.chapters.reduce((total, chapter) => total + chapter.charCount, 0)
        expect(parsed.totalChars).toBe(sum)
    })

    it('无卷标记时全部章节归入默认卷并给出告警', () => {
        const text = ['第一章 开端', '正文一。', '第二章 转折', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.volumeDirs).toEqual(['01-默认卷'])
        expect(parsed.chapters.every((chapter) => chapter.volumeDir === '01-默认卷')).toBe(true)
        expect(parsed.warnings.some((warning) => warning.includes('默认卷'))).toBe(true)
    })

    it('卷名与章名写在同一行时拆成卷与章节', () => {
        const text = ['第一卷 风起 第一章 少年', '正文一。', '第二章 入山', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.volumeDirs).toEqual(['01-风起'])
        expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(['第一章 少年', '第二章 入山'])
        expect(parsed.chapters[0]?.body).toBe('正文一。')
    })

    it('省略「第」的卷标记同样生效', () => {
        const text = ['卷一 风起', '第一章 开端', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.volumeDirs).toEqual(['01-风起'])
    })

    it('楔子与番外按特殊章节名切分', () => {
        const text = ['楔子', '正文一。', '第一章 开端', '正文二。', '番外 后日谈', '正文三。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(['楔子', '第一章 开端', '番外 后日谈'])
    })

    it('全角数字章号归一为半角标题', () => {
        const parsed = parseNovel(['第１２章 开端', '正文。'].join('\n'))
        expect(parsed.chapters[0]?.title).toBe('第12章 开端')
    })

    it('正文行首的章节引用不切章', () => {
        const text = ['第一章 开端', '第三章的内容让他很意外。', '第二章 转折', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.body).toContain('第三章的内容让他很意外。')
    })

    it('正文中的卷引用不改变章节落点', () => {
        const text = ['第一卷 风起', '第一章 开端', '第三卷的结尾他并不满意', '第二章 转折', '正文。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.volumeDirs).toEqual(['01-风起'])
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.body).toContain('第三卷的结尾他并不满意')
    })

    it('章号回退的弱格式标题按正文处理', () => {
        const text = ['第一章 开端', '正文一。', '第一章这句话重复了', '第二章 转折', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.body).toContain('第一章这句话重复了')
    })

    it('章节号与标题之间无分隔符时仍可识别', () => {
        const text = ['第一章开端', '正文一。', '第二章转折', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(['第一章开端', '第二章转折'])
    })

    it('数字顿号标题须序号严格连续，否则按正文处理', () => {
        const text = ['1、开端', '正文一。', '3、这是正文里的清单项', '2、转折', '正文二。'].join('\n')
        const parsed = parseNovel(text)
        expect(parsed.chapters).toHaveLength(2)
        expect(parsed.chapters[0]?.body).toContain('3、这是正文里的清单项')
    })
})

describe('sanitizeSegment', () => {
    it('半角非法字符替换为空格，全角标点原样保留', () => {
        expect(sanitizeSegment('第一章 雪夜:开端')).toBe('第一章 雪夜 开端')
        expect(sanitizeSegment('第一章 雪夜：开端')).toBe('第一章 雪夜：开端')
    })

    it('去掉首尾空白与结尾点', () => {
        expect(sanitizeSegment('  末尾点...  ')).toBe('末尾点')
    })

    it('超长标题按上限截断', () => {
        expect(sanitizeSegment('长'.repeat(60), 10)).toHaveLength(10)
    })

    it('清洗后为空时返回空串，由调用方兜底命名', () => {
        expect(sanitizeSegment('///')).toBe('')
    })
})
