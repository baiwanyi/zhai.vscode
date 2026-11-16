/**
 * noteFactory 单元测试：覆盖标题转文件名的合法化规则、默认标题序号、默认落点目录与空笔记内容闭环。
 * 用真实 parseFileMeta 验证标题可从一级标题提取；目录参数同时覆盖越界片段的拒绝口径。
 */
import { describe, expect, it } from 'vitest'
import { parseFileMeta } from '../src/modules/common/db/fileMeta'
import {
    buildDefaultNoteTitle,
    buildNoteContent,
    createNoteDraft,
    DEFAULT_NOTE_TITLE,
    toNoteFileName,
} from '../src/modules/note/noteFactory'

describe('toNoteFileName', () => {
    it('标题直接作为文件名', () => {
        expect(toNoteFileName('会议记录')).toBe('会议记录.md')
        expect(toNoteFileName('周报 2026-11')).toBe('周报 2026-11.md')
    })

    it('非法字符替换为空格并折叠连续空白', () => {
        expect(toNoteFileName('a/b:c*d?e"f<g>h|i\\j')).toBe('a b c d e f g h i j.md')
        expect(toNoteFileName('重复   空格')).toBe('重复 空格.md')
    })

    it('去掉首尾空白与结尾的点', () => {
        expect(toNoteFileName('  前后空白  ')).toBe('前后空白.md')
        expect(toNoteFileName('句末标点...')).toBe('句末标点.md')
    })

    it('空标题回退默认标题', () => {
        expect(toNoteFileName('   ')).toBe(`${DEFAULT_NOTE_TITLE}.md`)
        expect(toNoteFileName('///')).toBe(`${DEFAULT_NOTE_TITLE}.md`)
    })

    it('Windows 保留设备名加后缀', () => {
        expect(toNoteFileName('CON')).toBe('CON 未命名笔记.md')
        expect(toNoteFileName('com1')).toBe('com1 未命名笔记.md')
    })

    it('超长标题截断到 60 字以内', () => {
        const fileName = toNoteFileName('长'.repeat(120))
        expect(fileName).toBe(`${'长'.repeat(60)}.md`)
    })
})

describe('buildDefaultNoteTitle', () => {
    it('从 1 开始带序号', () => {
        expect(buildDefaultNoteTitle(1)).toBe(`${DEFAULT_NOTE_TITLE} 1`)
        expect(buildDefaultNoteTitle(12)).toBe(`${DEFAULT_NOTE_TITLE} 12`)
    })
})

describe('createNoteDraft', () => {
    it('默认落未分类笔记本', () => {
        const draft = createNoteDraft()
        expect(draft.path).toBe(`notes/未分类/${DEFAULT_NOTE_TITLE} 1.md`)
        expect(draft.path).toBe(`${draft.directory}/${draft.fileName}`)
        expect(draft.title).toBe(`${DEFAULT_NOTE_TITLE} 1`)
    })

    it('自定义标题即文件名', () => {
        const draft = createNoteDraft('读书笔记')
        expect(draft.fileName).toBe('读书笔记.md')
        expect(draft.content).toBe('# 读书笔记\n')
    })

    it('可指定目标笔记本目录', () => {
        expect(createNoteDraft('读书笔记', 'notes/AMZ').directory).toBe('notes/AMZ')
        expect(createNoteDraft('读书笔记', 'notes/AMZ').path).toBe('notes/AMZ/读书笔记.md')
    })

    it('拒绝越界与非法目录形态', () => {
        expect(() => createNoteDraft('读书笔记', 'notes/..')).toThrow('笔记本目录非法')
        expect(() => createNoteDraft('读书笔记', 'notes/../secret')).toThrow('笔记本目录非法')
        expect(() => createNoteDraft('读书笔记', 'press/剑来')).toThrow('笔记本目录非法')
        expect(() => createNoteDraft('读书笔记', 'notes\\\\a')).toThrow('笔记本目录非法')
        expect(() => createNoteDraft('读书笔记', 'C:/notes')).toThrow('笔记本目录非法')
    })

    it('不写 Frontmatter，标题由一级标题提取', () => {
        const draft = createNoteDraft()
        expect(draft.content).not.toContain('---')
        const meta = parseFileMeta(draft.content, draft.fileName)
        expect(meta.title).toBe(`${DEFAULT_NOTE_TITLE} 1`)
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
