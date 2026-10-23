/**
 * importParser 单元测试：覆盖分章、卷识别、前导内容处置、行首标题转义与文件名清洗。
 * 复用 countWords 的真实口径做字数断言，避免测试自造一套统计规则掩盖偏差。
 */
import { describe, expect, it } from 'vitest'
import { countWords } from '../modules/common/db/fileMeta'
import { parseNovel, sanitizeSegment } from '../modules/press/importParser'

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
