/**
 * projectRepository 单元测试：覆盖作品前缀扫描、目录归并、章节计数、README 识别与排序规则。
 * 用内存库跑真实 schema，避免测试自建表结构与实现漂移；断言只针对对外返回的摘要字段。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureSchema } from '../../src/modules/common/db/schema'
import {
    hasProjectFile,
    hasProjectFiles,
    listPressProjects,
    listProjectChapterPaths,
    readProjectDetail,
} from '../../src/modules/press/projectRepository'

let db: Database.Database

beforeEach(() => {
    db = new Database(':memory:')
    ensureSchema(db)
})

/** 生成可按字符串排序的 ISO 时间戳，序号补零以保证同月内单调递增 */
function toMtime(order: number): string {
    return `2026-10-${String(order).padStart(2, '0')}T00:00:00.000Z`
}

/** 插入文件行，order 同时决定字数与 mtime 的新旧；title 缺省用可识别的占位标题 */
function insertFile(path: string, order: number, title: string = `标题${order}`): void {
    db.prepare(
        `INSERT INTO files (path, title, word_count, tags, mtime, created_at, updated_at)
         VALUES (?, ?, ?, '[]', ?, ?, ?)`,
    ).run(path, title, order, toMtime(order), toMtime(1), toMtime(1))
}

describe('listPressProjects', () => {
    it('同一作品下的文档归并为一条摘要，字数合计且取最新修改时间', () => {
        insertFile('press/剑来/README.md', 1)
        insertFile('press/剑来/大纲.md', 3)
        insertFile('press/剑来/Chapters/01-初见.md', 5)

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
        insertFile('press/剑来/Chapters/01-第一卷/01-初见.md', 1)
        insertFile('press/剑来/Chapters/01-第一卷/02-再会.md', 2)
        insertFile('press/剑来/Chapters/02-外篇.md', 3)

        const [project] = listPressProjects(db)

        expect(project?.chapterCount).toBe(3)
    })

    it('仅作品根的 README.md 视为作品说明，子目录中的同名文件不计', () => {
        insertFile('press/剑来/Chapters/README.md', 1)

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

describe('readProjectDetail', () => {
    it('未分卷章节归入空卷组并排在最前，卷内按序号升序', () => {
        insertFile('press/剑来/Chapters/02-外篇.md', 2)
        insertFile('press/剑来/Chapters/01-初见.md', 1)
        insertFile('press/剑来/Chapters/01-第一卷/02-重逢.md', 3)
        insertFile('press/剑来/Chapters/01-第一卷/01-初遇.md', 5)
        insertFile('press/剑来/Chapters/02-第二卷/01-远行.md', 4)

        const detail = readProjectDetail(db, 'press/剑来')

        expect(detail?.volumes.map((volume) => volume.name)).toEqual(['', '第一卷', '第二卷'])
        expect(detail?.volumes.map((volume) => volume.dirName)).toEqual(['', '01-第一卷', '02-第二卷'])
        expect(detail?.volumes[0]?.chapters.map((chapter) => chapter.title)).toEqual(['标题1', '标题2'])
        expect(detail?.volumes[1]?.chapters.map((chapter) => chapter.title)).toEqual(['标题5', '标题3'])
        expect(detail?.project.chapterCount).toBe(5)
        expect(detail?.project.wordCount).toBe(15)
    })

    it('无序号前缀的章节排在有序项之后', () => {
        insertFile('press/剑来/Chapters/序章.md', 1)
        insertFile('press/剑来/Chapters/01-初见.md', 2)

        const chapters = readProjectDetail(db, 'press/剑来')?.volumes[0]?.chapters ?? []

        expect(chapters.map((chapter) => chapter.title)).toEqual(['标题2', '标题1'])
    })

    it('文档无标题时用去序号前缀的文件名兜底', () => {
        insertFile('press/剑来/Chapters/01-初见.md', 1, '01-初见.md')
        insertFile('press/剑来/Chapters/02-再会.md', 2, '第二章 再会')

        const chapters = readProjectDetail(db, 'press/剑来')?.volumes[0]?.chapters ?? []

        expect(chapters.map((chapter) => chapter.title)).toEqual(['初见', '第二章 再会'])
    })

    it('作品不存在或 dirPath 非法时返回 null', () => {
        insertFile('press/剑来/README.md', 1)

        expect(readProjectDetail(db, 'press/雪中')).toBeNull()
        expect(readProjectDetail(db, 'press')).toBeNull()
        expect(readProjectDetail(db, 'notes/剑来')).toBeNull()
        expect(readProjectDetail(db, 'press/剑来/Chapter')).toBeNull()
    })
})

describe('listProjectChapterPaths', () => {
    it('只返回 Chapters/ 下已登记的章节路径', () => {
        insertFile('press/剑来/README.md', 1)
        insertFile('press/剑来/大纲.md', 2)
        insertFile('press/剑来/Chapters/01-初见.md', 3)
        insertFile('press/剑来/Chapters/01-第一卷/01-初遇.md', 4)

        const paths = listProjectChapterPaths(db, 'press/剑来').sort()

        expect(paths).toEqual(['press/剑来/Chapters/01-初见.md', 'press/剑来/Chapters/01-第一卷/01-初遇.md'])
    })

    it('目录非法时返回空清单', () => {
        expect(listProjectChapterPaths(db, 'press')).toEqual([])
        expect(listProjectChapterPaths(db, 'notes/剑来')).toEqual([])
    })
})

describe('hasProjectFile', () => {
    it('仅精确命中已登记路径', () => {
        insertFile('press/剑来/Chapters/01-初见.md', 1)

        expect(hasProjectFile(db, 'press/剑来/Chapters/01-初见.md')).toBe(true)
        expect(hasProjectFile(db, 'press/剑来/Chapters/01-初见')).toBe(false)
        expect(hasProjectFile(db, 'press/剑来/Chapter')).toBe(false)
    })
})

describe('旧版章节目录兼容', () => {
    it('Chapter 下的文档仍计入章节数，并出现在章节清单里', () => {
        insertFile('press/剑来/README.md', 1)
        insertFile('press/剑来/Chapter/01-初见.md', 3)

        const projects = listPressProjects(db)

        expect(projects[0]?.chapterCount).toBe(1)
        expect(listProjectChapterPaths(db, 'press/剑来')).toEqual(['press/剑来/Chapter/01-初见.md'])
    })

    it('新旧目录并存时两份都计入，迁移过程中不会暂时丢章节', () => {
        insertFile('press/剑来/Chapter/01-初见.md', 1)
        insertFile('press/剑来/Chapters/02-远行.md', 3)

        expect(listProjectChapterPaths(db, 'press/剑来')).toHaveLength(2)
        expect(readProjectDetail(db, 'press/剑来')?.project.chapterCount).toBe(2)
    })
})
