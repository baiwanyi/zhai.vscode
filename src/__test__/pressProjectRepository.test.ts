/**
 * projectRepository 单元测试：覆盖作品前缀扫描、目录归并、章节计数、README 识别与排序规则。
 * 用内存库跑真实 schema，避免测试自建表结构与实现漂移；断言只针对对外返回的摘要字段。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureSchema } from '../modules/common/db/schema'
import { hasProjectFiles, listPressProjects } from '../modules/press/projectRepository'

let db: Database.Database

beforeEach(() => {
    db = new Database(':memory:')
    ensureSchema(db)
})

/** 生成可按字符串排序的 ISO 时间戳，序号补零以保证同月内单调递增 */
function toMtime(order: number): string {
    return `2026-10-${String(order).padStart(2, '0')}T00:00:00.000Z`
}

/** 插入文件行，order 同时决定字数与 mtime 的新旧 */
function insertFile(path: string, order: number): void {
    db.prepare(
        `INSERT INTO files (path, title, word_count, tags, mtime, created_at, updated_at)
         VALUES (?, ?, ?, '[]', ?, ?, ?)`,
    ).run(path, `标题${order}`, order, toMtime(order), toMtime(1), toMtime(1))
}

describe('listPressProjects', () => {
    it('同一作品下的文档归并为一条摘要，字数合计且取最新修改时间', () => {
        insertFile('press/剑来/README.md', 1)
        insertFile('press/剑来/大纲.md', 3)
        insertFile('press/剑来/Chapter/01-初见.md', 5)

        const projects = listPressProjects(db)

        expect(projects).toHaveLength(1)
        expect(projects[0]).toEqual({
            name: '剑来',
            dirPath: 'press/剑来',
            hasReadme: true,
            chapterCount: 1,
            wordCount: 9,
            mtime: toMtime(5),
        })
    })

    it('分卷目录下的章节同样计入章节数', () => {
        insertFile('press/剑来/Chapter/01-第一卷/01-初见.md', 1)
        insertFile('press/剑来/Chapter/01-第一卷/02-再会.md', 2)
        insertFile('press/剑来/Chapter/02-外篇.md', 3)

        const [project] = listPressProjects(db)

        expect(project?.chapterCount).toBe(3)
    })

    it('仅作品根的 README.md 视为作品说明，子目录中的同名文件不计', () => {
        insertFile('press/剑来/Chapter/README.md', 1)

        const [project] = listPressProjects(db)

        expect(project?.hasReadme).toBe(false)
    })

    it('press 顶层散落的文档不构成作品', () => {
        insertFile('press/灵感.md', 1)
        insertFile('press/剑来/README.md', 2)

        const projects = listPressProjects(db)

        expect(projects.map((project) => project.name)).toEqual(['剑来'])
    })

    it('其他模块的文件不进入作品列表', () => {
        insertFile('notes/202610/a.md', 1)
        insertFile('press0/a.md', 2)

        expect(listPressProjects(db)).toEqual([])
    })

    it('按最近更新时间倒序，同时间按作品名排序', () => {
        insertFile('press/乙/README.md', 2)
        insertFile('press/甲/README.md', 3)
        insertFile('press/丙/README.md', 3)

        const projects = listPressProjects(db)

        expect(projects.map((project) => project.name)).toEqual(['丙', '甲', '乙'])
    })
})

describe('hasProjectFiles', () => {
    beforeEach(() => {
        insertFile('press/剑来/README.md', 1)
    })

    it('作品目录内有已登记文档时返回 true', () => {
        expect(hasProjectFiles(db, 'press/剑来')).toBe(true)
    })

    it('未登记或前缀相近的目录返回 false', () => {
        expect(hasProjectFiles(db, 'press/雪中')).toBe(false)
        expect(hasProjectFiles(db, 'press/剑')).toBe(false)
        expect(hasProjectFiles(db, 'press/剑来/Chapter')).toBe(false)
    })
})
