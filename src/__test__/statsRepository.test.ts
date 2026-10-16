/**
 * statsRepository 单元测试：覆盖按路径批量取行、最近更新条数上限与置顶合并规则。
 * 用内存库跑真实 schema，避免测试自建表结构与实现漂移；纯合并规则直接构造行对象断言。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RecentFileRow } from '../modules/common/db/statsRepository'
import { ensureSchema } from '../modules/common/db/schema'
import { listFilesByPaths, listRecentFiles, mergePinnedFiles, RECENT_LIMIT } from '../modules/common/db/statsRepository'

let db: Database.Database

beforeEach(() => {
    db = new Database(':memory:')
    ensureSchema(db)
})

/** 生成可按字符串排序的 ISO 时间戳，序号补零以保证同月内单调递增 */
function toMtime(order: number): string {
    return `2026-10-${String(order).padStart(2, '0')}T00:00:00.000Z`
}

/** 插入文件行，order 越大 mtime 越新 */
function insertFile(path: string, order: number): void {
    db.prepare(
        `INSERT INTO files (path, title, word_count, tags, mtime, created_at, updated_at)
         VALUES (?, ?, ?, '[]', ?, ?, ?)`,
    ).run(path, `标题${order}`, order, toMtime(order), toMtime(1), toMtime(1))
}

/** 构造文件行，用于不依赖库的合并规则断言 */
function toRow(path: string, order: number): RecentFileRow {
    return { path, title: `标题${order}`, wordCount: order, mtime: toMtime(order) }
}

describe('listFilesByPaths', () => {
    beforeEach(() => {
        insertFile('notes/a.md', 1)
        insertFile('notes/b.md', 2)
        insertFile('notes/c.md', 3)
    })

    it('按入参顺序返回，不受库中时间顺序影响', () => {
        const rows = listFilesByPaths(db, ['notes/c.md', 'notes/a.md'])
        expect(rows.map((row) => row.path)).toEqual(['notes/c.md', 'notes/a.md'])
    })

    it('跳过索引库中已不存在的路径', () => {
        const rows = listFilesByPaths(db, ['notes/a.md', 'notes/missing.md'])
        expect(rows.map((row) => row.path)).toEqual(['notes/a.md'])
    })

    it('入参为空时返回空列表', () => {
        expect(listFilesByPaths(db, [])).toEqual([])
    })
})

describe('listRecentFiles', () => {
    it('默认按 mtime 倒序取 RECENT_LIMIT 条', () => {
        for (let order = 1; order <= RECENT_LIMIT + 5; order += 1) {
            insertFile(`notes/f${order}.md`, order)
        }
        const rows = listRecentFiles(db)
        expect(rows).toHaveLength(RECENT_LIMIT)
        expect(rows.map((row) => row.path)[0]).toBe(`notes/f${RECENT_LIMIT + 5}.md`)
    })
})

describe('mergePinnedFiles', () => {
    it('置顶项置于最前并标记 isPinned，其余保留 mtime 倒序', () => {
        const pinned = [toRow('notes/b.md', 2)]
        const recent = [toRow('notes/c.md', 3), toRow('notes/b.md', 2), toRow('notes/a.md', 1)]
        const merged = mergePinnedFiles(pinned, recent, 10)
        expect(merged.map((file) => file.path)).toEqual(['notes/b.md', 'notes/c.md', 'notes/a.md'])
        expect(merged.map((file) => file.isPinned)).toEqual([true, false, false])
    })

    it('同时命中置顶与最近更新的路径只出现一次', () => {
        const pinned = [toRow('notes/b.md', 2)]
        const recent = [toRow('notes/b.md', 2)]
        const merged = mergePinnedFiles(pinned, recent, 10)
        expect(merged).toHaveLength(1)
    })

    it('总数按 limit 截断', () => {
        const recent = [toRow('notes/a.md', 1), toRow('notes/b.md', 2), toRow('notes/c.md', 3)]
        const merged = mergePinnedFiles([], recent, 2)
        expect(merged.map((file) => file.path)).toEqual(['notes/a.md', 'notes/b.md'])
    })

    it('置顶项占满上限时不再追加其余条目，且置顶项本身不被裁剪', () => {
        const pinned = [toRow('notes/a.md', 1), toRow('notes/b.md', 2)]
        const recent = [toRow('notes/c.md', 3)]
        const merged = mergePinnedFiles(pinned, recent, 2)
        expect(merged.map((file) => file.path)).toEqual(['notes/a.md', 'notes/b.md'])
    })

    it('并入置顶项后仍按 limit 补足其余条目', () => {
        const pinned = [toRow('notes/c.md', 3)]
        const recent = [toRow('notes/c.md', 3), toRow('notes/b.md', 2), toRow('notes/a.md', 1)]
        const merged = mergePinnedFiles(pinned, recent, 3)
        expect(merged.map((file) => file.path)).toEqual(['notes/c.md', 'notes/b.md', 'notes/a.md'])
    })
})
