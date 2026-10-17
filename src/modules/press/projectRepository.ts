/**
 * 作品聚合仓储：按索引库 files 表前缀扫描 press/ 目录，归并出作品摘要（目录即作品）。
 * 安全约束：SQL 全参数化，模块前缀与目录前缀均以绑定参数传入，不拼接任何字面量；只读，不写库。
 * 关键约束：作品须位于 press/{作品名}/ 之下（至少三段路径），press/ 顶层散落的 md 不构成作品；
 * 章节计数以第三段是否为 Chapter 判定，兼容分卷（Chapter/01-卷名/*.md）；
 * 作品顺序按最近更新时间倒序，同时间按名称本地化排序，保证列表稳定可复现。
 */
import { PROJECT_CHAPTER_DIR, PROJECT_README_NAME, PRESS_MODULE_DIR } from './projectFactory'
import type { PressProjectSummary } from '../../shared/types/press'
import type Database from 'better-sqlite3'

/** 聚合所需的最小列投影 */
const PROJECT_FILE_COLUMNS = 'path, word_count AS wordCount, mtime'

interface ProjectFileRow {
    path: string
    wordCount: number
    mtime: string
}

/** 单个作品的聚合中间态 */
interface ProjectAccumulator {
    name: string
    wordCount: number
    chapterCount: number
    mtime: string
    hasReadme: boolean
}

/** 取作品模块的前缀，形如 press/ */
function readPressPrefix(): string {
    return `${PRESS_MODULE_DIR}/`
}

/** 列出全部作品摘要：宿主只读聚合，前端据此渲染列表 */
export function listPressProjects(db: Database.Database): PressProjectSummary[] {
    const prefix = readPressPrefix()
    // 用 substr 前缀比较而非 LIKE：作品名可能含 _ 与 %，LIKE 会误匹配且需额外转义
    const rows = db
        .prepare(`SELECT ${PROJECT_FILE_COLUMNS} FROM files WHERE substr(path, 1, ?) = ?`)
        .all(prefix.length, prefix) as ProjectFileRow[]
    const accumulators = new Map<string, ProjectAccumulator>()
    for (const row of rows) {
        const segments = row.path.split('/')
        // 至少 press/{作品}/{文件} 三段才归属作品
        if (segments.length < 3) {
            continue
        }
        const name = segments[1]
        if (name === undefined || name.length === 0) {
            continue
        }
        const current = accumulators.get(name) ?? {
            name,
            wordCount: 0,
            chapterCount: 0,
            mtime: row.mtime,
            hasReadme: false,
        }
        current.wordCount += row.wordCount
        if (row.mtime > current.mtime) {
            current.mtime = row.mtime
        }
        if (segments.length === 3 && segments[2] === PROJECT_README_NAME) {
            current.hasReadme = true
        }
        if (segments[2] === PROJECT_CHAPTER_DIR) {
            current.chapterCount += 1
        }
        accumulators.set(name, current)
    }
    return [...accumulators.values()]
        .sort((left, right) => right.mtime.localeCompare(left.mtime) || left.name.localeCompare(right.name, 'zh'))
        .map((item) => ({
            name: item.name,
            dirPath: `${PRESS_MODULE_DIR}/${item.name}`,
            hasReadme: item.hasReadme,
            chapterCount: item.chapterCount,
            wordCount: item.wordCount,
            mtime: item.mtime,
        }))
}

/**
 * 判断作品目录是否含已登记文档：打开作品的入参来自 Webview，须先回查索引库再触达文件系统，
 * 从源头排除任意目录（含上跳与盘符形态）被打开。
 */
export function hasProjectFiles(db: Database.Database, dirPath: string): boolean {
    const prefix = `${dirPath}/`
    const row = db
        .prepare('SELECT 1 AS found FROM files WHERE substr(path, 1, ?) = ? LIMIT 1')
        .get(prefix.length, prefix) as { found: number } | undefined
    return row !== undefined
}
