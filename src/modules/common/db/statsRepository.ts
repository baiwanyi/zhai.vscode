/**
 * 仪表盘统计仓储：对 files 表做只读聚合，产出写作统计、笔记本分组与最近更新列表。
 * 笔记本口径：notes/ 下的二级目录即一个笔记本，笔记根下的散落文档统一归入「未分类」；
 * 数据源只有索引库，空目录与目录 mtime 由宿主侧扫盘补齐，本模块不触碰文件系统。
 * 安全约束：全部 SQL 使用预编译语句，路径仅作绑定参数、IN 占位符由入参长度生成；仅只读查询，不写库。
 * 关键约束：置顶标记源自宿主偏好而非索引库，合并时置顶项顺序优先且不受条数截断影响；
 * 字数、文件数与标签只统计笔记与作品，词库、待办、参考资料等目录不计入写作成果；
 * 目录过滤统一用 substr(path, 1, ?) = ? 比较，避开 LIKE 对 _ 与 % 的转义问题。
 */
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import type { ModuleStat, RecentFile } from '@shared/types/dashboard'
import { safeParseTags } from './indexRepository'
import type Database from 'better-sqlite3'

/** 无一级目录的顶层文件归入的模块名 */
export const ROOT_MODULE_NAME = '根目录'

/** 笔记目录前缀：与 note/noteFactory.ts 的 NOTE_DIR 保持一致，改动需两侧同步 */
export const NOTE_PATH_PREFIX = 'notes/'

/** 未分类笔记本的目录名：没有指定笔记本的新笔记都落在这里 */
export const UNCLASSIFIED_NOTEBOOK_DIR = '未分类'

/**
 * 未分类笔记本的 id：既是真实目录 notes/未分类，也承载笔记根下散落的文档。
 * 关键约束：写入侧只落 notes/未分类/ 下的真实路径，读取侧额外并入 notes/<文件>.md，
 * 使历史上直接放在笔记根下的文档也有归属，无需搬迁用户的文件。
 */
export const UNCLASSIFIED_NOTEBOOK_ID = `${NOTE_PATH_PREFIX}${UNCLASSIFIED_NOTEBOOK_DIR}`

/** 最近更新列表默认条数（置顶项与最近更新合计上限） */
export const RECENT_LIMIT = 20

/** 笔记目录条件片段，绑定参数依次为前缀长度与前缀本身 */
const NOTE_SCOPE = 'substr(path, 1, ?) = ?'

/**
 * 计入统计的目录前缀：只有笔记与作品属于写作产出。
 * 关键约束：词库、待办、参考资料等目录即便被索引，也不能计入字数、文件数与标签数，
 * 否则仪表盘会把插件的配置数据当成写作成果。
 */
const COUNTED_PREFIXES: readonly string[] = [NOTE_PATH_PREFIX, `${PRESS_MODULE_DIR}/`]

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

/** 笔记本聚合行：只由索引库算出，空目录的补录由宿主侧扫盘完成 */
export interface NotebookAggregate {
    /** 笔记本 id，形如 notes/AMZ；未分类固定为 notes/未分类 */
    id: string
    /** 展示名，即目录名（未分类同样取目录名） */
    name: string
    noteCount: number
    wordCount: number
    /** 目录内最新笔记的 mtime；无笔记时为空串，由宿主回落到目录 stat.mtime */
    mtime: string
}

/** 文件级聚合结果：前三项只统计笔记与作品，笔记本分布进一步收窄到笔记目录 */
export interface FileAggregate {
    /** 写作文档数（笔记 + 作品） */
    indexedCount: number
    /** 写作文档字数合计 */
    totalWords: number
    /** 写作文档的去重标签数 */
    tagCount: number
    /** 笔记目录下的模块分布：只统计 notes/ 下的文件，press 等其它模块不计入 */
    moduleStats: ModuleStat[]
    /** 笔记本分组：按 notes/ 下的二级目录聚合，笔记根下的散落文档归入未分类 */
    notebookStats: NotebookAggregate[]
}

/** 单次扫描 files 表完成全部文件级聚合，避免多次全表查询；计数与字数按写作范围收窄 */
export function aggregateFileStats(db: Database.Database): FileAggregate {
    const rows = db
        .prepare('SELECT path, word_count AS wordCount, tags, mtime FROM files')
        .all() as (FileAggregateRow & { mtime: string })[]
    const notebooks = new Map<string, NotebookAggregate>()
    const tags = new Set<string>()
    let indexedCount = 0
    let totalWords = 0
    for (const row of rows) {
        // 字数、文件数与标签只统计笔记与作品：词库、待办、参考资料等目录不属于写作产出
        if (!COUNTED_PREFIXES.some((prefix) => row.path.startsWith(prefix))) {
            continue
        }
        indexedCount += 1
        totalWords += row.wordCount
        for (const tag of safeParseTags(row.tags)) {
            tags.add(tag)
        }
        if (!row.path.startsWith(NOTE_PATH_PREFIX)) {
            continue
        }
        const id = toNotebookId(row.path)
        const notebook = notebooks.get(id) ?? { id, name: toNotebookName(id), noteCount: 0, wordCount: 0, mtime: '' }
        notebook.noteCount += 1
        notebook.wordCount += row.wordCount
        // mtime 是 ISO 8601 串，字符串比较即时间先后比较，无需再转 Date
        if (row.mtime > notebook.mtime) {
            notebook.mtime = row.mtime
        }
        notebooks.set(id, notebook)
    }
    const notebookStats = [...notebooks.values()].sort(
        (a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name),
    )
    const moduleStats = notebookStats.map((notebook) => ({
        name: notebook.name,
        fileCount: notebook.noteCount,
        wordCount: notebook.wordCount,
    }))
    return { indexedCount, totalWords, tagCount: tags.size, moduleStats, notebookStats }
}

/**
 * 读取某个笔记本下的笔记：按 mtime 倒序，条数由调用方限制。
 * 关键约束：未分类要并入笔记根下的散落文档，两种形态的并集才是它的完整集合；
 * 判定散落文档用 instr 而不是 LIKE，避开 _ 与 % 的转义问题（与目录过滤口径一致）。
 */
export function listNotesByNotebook(
    db: Database.Database,
    notebookId: string,
    limit: number,
): RecentFileRow[] {
    if (notebookId === UNCLASSIFIED_NOTEBOOK_ID) {
        return db
            .prepare(
                `SELECT ${FILE_ROW_COLUMNS}
                 FROM files
                 WHERE (substr(path, 1, ?) = ? OR instr(substr(path, ?, 100), '/') = 0)
                   AND ${NOTE_SCOPE}
                 ORDER BY mtime DESC
                 LIMIT ?`,
            )
            .all(
                UNCLASSIFIED_NOTEBOOK_ID.length + 1,
                `${UNCLASSIFIED_NOTEBOOK_ID}/`,
                NOTE_PATH_PREFIX.length + 1,
                NOTE_PATH_PREFIX.length,
                NOTE_PATH_PREFIX,
                limit,
            ) as RecentFileRow[]
    }
    return db
        .prepare(
            `SELECT ${FILE_ROW_COLUMNS}
             FROM files
             WHERE substr(path, 1, ?) = ? AND ${NOTE_SCOPE}
             ORDER BY mtime DESC
             LIMIT ?`,
        )
        .all(
            notebookId.length + 1,
            `${notebookId}/`,
            NOTE_PATH_PREFIX.length,
            NOTE_PATH_PREFIX,
            limit,
        ) as RecentFileRow[]
}

/** 读取最近更新的笔记（按 mtime 倒序，只含 notes/ 目录） */
export function listRecentFiles(db: Database.Database, limit: number = RECENT_LIMIT): RecentFileRow[] {
    return db
        .prepare(
            `SELECT ${FILE_ROW_COLUMNS}
             FROM files
             WHERE ${NOTE_SCOPE}
             ORDER BY mtime DESC
             LIMIT ?`,
        )
        .all(NOTE_PATH_PREFIX.length, NOTE_PATH_PREFIX, limit) as RecentFileRow[]
}

/**
 * 跨笔记本搜索笔记：标题或路径命中关键词即返回，按 mtime 倒序截断。
 * 关键约束：用 instr + lower 做包含匹配而不是 LIKE，避开关键词里 % 与 _ 的转义问题；
 * 只搜 notes/ 目录，回收站已被索引排除，不会出现在结果里。
 */
export function searchNotes(db: Database.Database, keyword: string, limit: number): RecentFileRow[] {
    const normalized = keyword.trim().toLowerCase()
    if (normalized === '') {
        return []
    }
    return db
        .prepare(
            `SELECT ${FILE_ROW_COLUMNS}
             FROM files
             WHERE ${NOTE_SCOPE}
               AND (instr(lower(title), ?) > 0 OR instr(lower(path), ?) > 0)
             ORDER BY mtime DESC
             LIMIT ?`,
        )
        .all(NOTE_PATH_PREFIX.length, NOTE_PATH_PREFIX, normalized, normalized, limit) as RecentFileRow[]
}

/**
 * 按路径集合读取笔记行：返回顺序与入参一致，库中已不存在的路径直接跳过。
 * 只认 notes/ 目录，press 等其它模块的路径即使传入也不会返回（置顶残留、打开与置顶校验共用此口径）。
 */
export function listFilesByPaths(db: Database.Database, paths: string[]): RecentFileRow[] {
    if (paths.length === 0) {
        return []
    }
    // 占位符数量由入参长度生成，路径值仍走绑定参数，SQL 文本不拼接任何字面量
    const placeholders = paths.map(() => '?').join(', ')
    const rows = db
        .prepare(`SELECT ${FILE_ROW_COLUMNS} FROM files WHERE path IN (${placeholders}) AND ${NOTE_SCOPE}`)
        .all(...paths, NOTE_PATH_PREFIX.length, NOTE_PATH_PREFIX) as RecentFileRow[]
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

/**
 * 取笔记所属的笔记本 id：notes/ 下的二级目录即一个笔记本，笔记根下的文档归入未分类。
 * 关键约束：只认前两段，更深层级的子目录仍归属其所在的笔记本，不产生新的笔记本；
 * 宿主侧删除与回收站元数据也用它还原归属，保证两侧口径只有一个来源。
 */
export function toNotebookId(relativePath: string): string {
    const segments = relativePath.split('/')
    const directory = segments[1]
    return segments.length >= 3 && directory !== undefined && directory.length > 0
        ? `${NOTE_PATH_PREFIX}${directory}`
        : UNCLASSIFIED_NOTEBOOK_ID
}

/** 取笔记本展示名：id 去掉 notes/ 前缀即目录名，未分类同样取目录名 */
function toNotebookName(notebookId: string): string {
    return notebookId.slice(NOTE_PATH_PREFIX.length)
}
