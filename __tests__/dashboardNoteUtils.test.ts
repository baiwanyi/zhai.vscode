/**
 * dashboardNoteUtils 单元测试：覆盖删除弹窗标题反查表、笔记归属笔记本与删除失败提示。
 * 纯函数测试，不依赖 DOM 与宿主协议；断言集中在同名路径的覆盖顺序、id 前缀边界与失败文案口径三处。
 */
import { describe, expect, it } from 'vitest'
import type { RecentFile } from '../src/shared/types/dashboard'
import { buildTitleByPath, formatNoteDeleteFailure, isNoteUnderNotebook } from '../src/dashboard/note/utils'

/** 构造笔记条目：只填被测逻辑关心的字段 */
function createNote(path: string, title: string): RecentFile {
    return { path, title, wordCount: 0, mtime: '2026-11-16T00:00:00.000Z', isPinned: false }
}

describe('buildTitleByPath', () => {
    it('合并多组笔记并按路径索引标题', () => {
        const map = buildTitleByPath([createNote('notes/读书/a.md', '甲')], [createNote('notes/读书/b.md', '乙')])
        expect(map.get('notes/读书/a.md')).toBe('甲')
        expect(map.get('notes/读书/b.md')).toBe('乙')
    })

    it('同名路径以后传入的组为准', () => {
        const map = buildTitleByPath(
            [createNote('notes/读书/a.md', '旧标题')],
            [createNote('notes/读书/a.md', '新标题')],
        )
        expect(map.get('notes/读书/a.md')).toBe('新标题')
    })

    it('空组不写入任何键', () => {
        expect(buildTitleByPath([], []).size).toBe(0)
        expect(buildTitleByPath().size).toBe(0)
    })
})

describe('formatNoteDeleteFailure', () => {
    it('单条失败直接给出原因', () => {
        expect(formatNoteDeleteFailure([{ message: '笔记未保存' }])).toBe('笔记未保存')
    })

    it('多条失败只给条数与首条原因', () => {
        expect(formatNoteDeleteFailure([{ message: '笔记未保存' }, { message: '第二条原因' }])).toBe(
            '2 篇笔记删除失败：笔记未保存',
        )
    })

    it('空数组给出兜底文案', () => {
        expect(formatNoteDeleteFailure([])).toBe('笔记删除失败')
    })
})

describe('isNoteUnderNotebook', () => {
    it('识别笔记本下的直属与深层笔记', () => {
        expect(isNoteUnderNotebook('notes/读书/a.md', 'notes/读书')).toBe(true)
        expect(isNoteUnderNotebook('notes/读书/2026/a.md', 'notes/读书')).toBe(true)
    })

    it('前缀相同但并非同一笔记本时不误判', () => {
        expect(isNoteUnderNotebook('notes/读书笔记/a.md', 'notes/读书')).toBe(false)
    })

    it('其它模块与笔记本自身路径不算归属', () => {
        expect(isNoteUnderNotebook('press/剑来/正文.md', 'notes/读书')).toBe(false)
        expect(isNoteUnderNotebook('notes/读书', 'notes/读书')).toBe(false)
    })
})
