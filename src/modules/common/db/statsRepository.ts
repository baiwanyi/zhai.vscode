/**
 * 仪表盘统计仓储：对 files 表做只读聚合，供 DashboardViewProvider 组装统计快照。
 * 安全约束：全部 SQL 使用预编译语句，禁止字符串拼接；仅只读查询，不写库。
 */
import { safeParseTags } from './indexRepository'
import type { ModuleStat, RecentFile } from '../../../shared/types/dashboard'
import type Database from 'better-sqlite3'

/** 无一级目录的顶层文件归入的模块名 */
export const ROOT_MODULE_NAME = '根目录'

/** 最近更新列表默认条数 */
const RECENT_LIMIT = 5

interface FileAggregateRow {
    path: string
    wordCount: number
    tags: string
}

/** 文件级聚合结果：计数、字数、标签去重数与模块分布 */
export interface FileAggregate {
    indexedCount: number
    totalWords: number
    tagCount: number
    moduleStats: ModuleStat[]
}

/** 单次扫描 files 表完成全部文件级聚合，避免多次全表查询 */
export function aggregateFileStats(db: Database.Database): FileAggregate {
    const rows = db.prepare('SELECT path, word_count AS wordCount, tags FROM files').all() as FileAggregateRow[]
    const modules = new Map<string, ModuleStat>()
    const tags = new Set<string>()
    let totalWords = 0
    for (const row of rows) {
        totalWords += row.wordCount
        for (const tag of safeParseTags(row.tags)) {
            tags.add(tag)
        }
        const name = toModuleName(row.path)
        const stat = modules.get(name) ?? { name, fileCount: 0, wordCount: 0 }
        stat.fileCount += 1
        stat.wordCount += row.wordCount
        modules.set(name, stat)
    }
    const moduleStats = [...modules.values()].sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name))
    return { indexedCount: rows.length, totalWords, tagCount: tags.size, moduleStats }
}

/** 读取最近更新的文件（按 mtime 倒序） */
export function listRecentFiles(db: Database.Database, limit: number = RECENT_LIMIT): RecentFile[] {
    return db
        .prepare(
            `SELECT path, title, word_count AS wordCount, mtime
             FROM files
             ORDER BY mtime DESC
             LIMIT ?`,
        )
        .all(limit) as RecentFile[]
}

/** 取相对路径的一级目录名，顶层文件归入「根目录」 */
function toModuleName(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_NAME
}
