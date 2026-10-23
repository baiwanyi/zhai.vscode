/**
 * noteFactory 单元测试：覆盖 ID 格式与不可预测性、年月目录规则、空笔记内容与索引解析闭环。
 * 全程使用本地时间构造日期，避免时区差异导致断言漂移；用真实 parseFileMeta 验证标题可从一级标题提取。
 */
import { describe, expect, it } from 'vitest'
import { parseFileMeta } from '../src/modules/common/db/fileMeta'
import { buildNoteContent, createNoteDraft, DEFAULT_NOTE_TITLE, generateNoteId } from '../src/modules/note/noteFactory'

describe('generateNoteId', () => {
    it('生成 8-4-4-4-12 分组的十六进制 ID', () => {
        const id = generateNoteId(Date.now())
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('同一毫秒连续生成不重复', () => {
        const now = Date.now()
        const ids = new Set(Array.from({ length: 200 }, () => generateNoteId(now)))
        expect(ids.size).toBe(200)
    })

    it('同一天不同时刻生成的 ID 不含顺序可预测的时间戳前缀', () => {
        const morning = generateNoteId(new Date(2026, 9, 15, 8, 0, 0).getTime())
        const evening = generateNoteId(new Date(2026, 9, 15, 20, 0, 0).getTime())
        expect(morning.slice(0, 8)).not.toBe(evening.slice(0, 8))
    })
})

describe('createNoteDraft', () => {
    it('路径为 notes/年月/{id}.md', () => {
        const draft = createNoteDraft(new Date(2026, 9, 15, 10, 30))
        expect(draft.path).toMatch(/^notes\/202610\/[0-9a-f-]{36}\.md$/)
        expect(draft.path).toBe(`${draft.directory}/${draft.fileName}`)
        expect(draft.title).toBe(DEFAULT_NOTE_TITLE)
    })

    it('单位数月份补零', () => {
        expect(createNoteDraft(new Date(2026, 0, 5)).directory).toBe('notes/202601')
    })

    it('不写 Frontmatter，标题由一级标题提取', () => {
        const draft = createNoteDraft(new Date(2026, 9, 15, 10, 30))
        expect(draft.content).not.toContain('---')
        const meta = parseFileMeta(draft.content, draft.fileName)
        expect(meta.title).toBe(DEFAULT_NOTE_TITLE)
        expect(meta.tags).toEqual([])
        expect(meta.wordCount).toBeGreaterThan(0)
        expect(meta.hash).toHaveLength(16)
    })
})

describe('buildNoteContent', () => {
    it('仅含一级标题，不写 Frontmatter 区块', () => {
        const content = buildNoteContent('会议记录')
        expect(content).toBe('# 会议记录\n')
        expect(content).not.toContain('---')
        expect(content).not.toContain('source:')
        expect(content).not.toContain('created:')
    })

    it('以换行结尾，为光标落在标题下方留出位置', () => {
        const content = buildNoteContent('会议记录')
        expect(content.split('\n')).toHaveLength(2)
        expect(content.endsWith('\n')).toBe(true)
    })
})
