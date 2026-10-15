/**
 * 仪表盘统计仓储：对 files 表做只读聚合与最近更新读取，并按宿主下发的置顶顺序合并成列表快照。
 * 安全约束：全部 SQL 使用预编译语句，路径仅作绑定参数、IN 占位符由入参长度生成；仅只读查询，不写库。
 * 关键约束：置顶标记源自宿主偏好而非索引库，合并时置顶项顺序优先且不受条数截断影响。
 */
import { safeParseTags } from './indexRepository'
import type { ModuleStat, RecentFile } from '../../../shared/types/dashboard'
import type Database from 'better-sqlite3'

/** 无一级目录的顶层文件归入的模块名 */
export const ROOT_MODULE_NAME = '根目录'

/** 最近更新列表默认条数（置顶项与最近更新合计上限） */
export const RECENT_LIMIT = 20

/** 索引库中的文件行：置顶标记由宿主偏好决定，不落在 files 表中 */
export interface RecentFileRow {
    path: string
    title: string
    wordCount: number
    mtime: string
}

/** 文件行的公共投影列，保证列表类查询返回同构结果 */
const FILE_ROW_COLUMNS = 'path, title, word_count AS wordCount, mtime'

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
export function listRecentFiles(db: Database.Database, limit: number = RECENT_LIMIT): RecentFileRow[] {
    return db
        .prepare(
            `SELECT ${FILE_ROW_COLUMNS}
             FROM files
             ORDER BY mtime DESC
             LIMIT ?`,
        )
        .all(limit) as RecentFileRow[]
}

/** 按路径集合读取文件行：返回顺序与入参一致，库中已不存在的路径直接跳过 */
export function listFilesByPaths(db: Database.Database, paths: string[]): RecentFileRow[] {
    if (paths.length === 0) {
        return []
    }
    // 占位符数量由入参长度生成，路径值仍走绑定参数，SQL 文本不拼接任何字面量
    const placeholders = paths.map(() => '?').join(', ')
    const rows = db
        .prepare(`SELECT ${FILE_ROW_COLUMNS} FROM files WHERE path IN (${placeholders})`)
        .all(...paths) as RecentFileRow[]
    const byPath = new Map(rows.map((row) => [row.path, row]))
    return paths.flatMap((path) => {
        const row = byPath.get(path)
        return row === undefined ? [] : [row]
    })
}

/** 合并置顶项与最近更新：置顶项按偏好顺序置于最前并标记 isPinned，其余保留 mtime 倒序；总数按 limit 截断且不裁剪置顶项 */
export function mergePinnedFiles(pinned: RecentFileRow[], recent: RecentFileRow[], limit: number): RecentFile[] {
    const pinnedPaths = new Set(pinned.map((file) => file.path))
    const rest = recent.filter((file) => !pinnedPaths.has(file.path))
    const merged: RecentFile[] = [
        ...pinned.map((file) => ({ ...file, isPinned: true })),
        ...rest.map((file) => ({ ...file, isPinned: false })),
    ]
    return merged.slice(0, Math.max(limit, pinned.length))
}

/** 取相对路径的一级目录名，顶层文件归入「根目录」 */
function toModuleName(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_NAME
}
