/**
 * 作品聚合仓储：按索引库 files 表前缀扫描，归并出作品摘要、卷分组章节与章节路径清单（目录即作品）。
 * 安全约束：SQL 全参数化，模块前缀与作品前缀均以绑定参数传入，不拼接任何字面量；只读，不写库。
 * 关键约束：作品须位于 press/{作品名}/ 之下（至少三段路径），press/ 顶层散落的 md 不构成作品；
 * 章节以第三段是否为章节目录判定（新名 Chapters 与旧名 Chapter 都认），兼容分卷（Chapters/01-卷名/*.md）；
 * 章节与卷按序号前缀排序，缺失前缀的条目排在有序项之后；章节标题取自 Frontmatter title，
 * 文档未声明标题时才用去序号前缀的文件名兜底展示。
 */
import {
    CHAPTER_DIR_NAMES,
    PROJECT_README_NAME,
    PRESS_MODULE_DIR,
    compareByOrder,
    readOrderPrefix,
    toDisplayName,
} from './projectFactory'
import type {
    PressChapterEntry,
    PressProjectDetail,
    PressProjectSummary,
    PressVolumeGroup,
} from '../../shared/types/press'
import type Database from 'better-sqlite3'

/** 聚合所需的最小列投影 */
const PROJECT_FILE_COLUMNS = 'path, title, word_count AS wordCount, mtime'

/** 章节路径的最小段数：press/{作品}/Chapters/{文件} */
const CHAPTER_PATH_DEPTH = 4

/** 判断路径第三段是否为章节目录：新旧两种写法都认，旧作品迁移前仍能正常分组 */
function isChapterSegment(segment: string | undefined): boolean {
    return segment !== undefined && CHAPTER_DIR_NAMES.includes(segment)
}

interface ProjectFileRow {
    path: string
    title: string
    wordCount: number
    mtime: string
}

/** 章节目录下的一个文档，连同其排序键一起暂存，避免排序期重复解析文件名 */
interface ChapterNode {
    entry: PressChapterEntry
    order: number | null
}

/** 取作品模块的前缀，形如 press/ */
function readPressPrefix(): string {
    return `${PRESS_MODULE_DIR}/`
}

/** 按前缀读取文件行：模块级与作品级共用，前缀以绑定参数传入（不用 LIKE，避开 _ 与 % 的转义问题） */
function listPrefixFiles(db: Database.Database, prefix: string): ProjectFileRow[] {
    return db
        .prepare(`SELECT ${PROJECT_FILE_COLUMNS} FROM files WHERE substr(path, 1, ?) = ?`)
        .all(prefix.length, prefix) as ProjectFileRow[]
}

/** 按前缀读取文件路径：章节与卷清单共用，前缀同样走绑定参数 */
function listPathsByPrefix(db: Database.Database, prefix: string): string[] {
    const rows = db.prepare('SELECT path FROM files WHERE substr(path, 1, ?) = ?').all(prefix.length, prefix) as Array<{
        path: string
    }>
    return rows.map((row) => row.path)
}

/** 取路径的文件名部分 */
function readFileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1)
}

/** 从 dirPath 解析作品名：仅接受 press/{作品名} 两段，其余返回 null */
function readProjectName(dirPath: string): string | null {
    const segments = dirPath.split('/')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        return null
    }
    const name = segments[1]
    return name === undefined || name.length === 0 ? null : name
}

/** 归并单作品的摘要：字数合计、章节数、README 存在性与最新更新时间 */
function aggregateProject(name: string, rows: ProjectFileRow[]): PressProjectSummary {
    let wordCount = 0
    let chapterCount = 0
    let mtime = ''
    let hasReadme = false
    for (const row of rows) {
        const segments = row.path.split('/')
        if (segments.length < 3) {
            continue
        }
        wordCount += row.wordCount
        if (mtime.length === 0 || row.mtime > mtime) {
            mtime = row.mtime
        }
        if (segments.length === 3 && segments[2] === PROJECT_README_NAME) {
            hasReadme = true
        }
        if (isChapterSegment(segments[2])) {
            chapterCount += 1
        }
    }
    return { name, dirPath: `${PRESS_MODULE_DIR}/${name}`, hasReadme, chapterCount, wordCount, mtime }
}

/** 列出全部作品摘要：宿主只读聚合，前端据此渲染列表 */
export function listPressProjects(db: Database.Database): PressProjectSummary[] {
    const rows = listPrefixFiles(db, readPressPrefix())
    const grouped = new Map<string, ProjectFileRow[]>()
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
        const bucket = grouped.get(name)
        if (bucket === undefined) {
            grouped.set(name, [row])
        } else {
            bucket.push(row)
        }
    }
    return [...grouped.entries()]
        .map(([name, files]) => aggregateProject(name, files))
        .sort((left, right) => right.mtime.localeCompare(left.mtime) || left.name.localeCompare(right.name, 'zh'))
}

/**
 * 读取作品详情：一次前缀扫描同时产出作品摘要与卷分组章节，避免详情页多次往返。
 * 作品不存在（索引库无该目录下任何文档）时返回 null，由宿主转成明确的错误提示。
 */
export function readProjectDetail(db: Database.Database, dirPath: string): PressProjectDetail | null {
    const name = readProjectName(dirPath)
    if (name === null) {
        return null
    }
    const rows = listPrefixFiles(db, `${PRESS_MODULE_DIR}/${name}/`)
    if (rows.length === 0) {
        return null
    }
    const volumes = new Map<string, ChapterNode[]>()
    for (const row of rows) {
        const segments = row.path.split('/')
        if (segments.length < CHAPTER_PATH_DEPTH || !isChapterSegment(segments[2])) {
            continue
        }
        const fileName = readFileName(row.path)
        if (fileName.length === 0) {
            continue
        }
        // 分卷目录位于 Chapter 之下；更深的层级归入该卷，不再向下建树
        const volumeDir = segments.length > CHAPTER_PATH_DEPTH ? (segments[3] ?? '') : ''
        const entry: PressChapterEntry = {
            path: row.path,
            title: row.title === fileName ? toDisplayName(fileName) : row.title,
            wordCount: row.wordCount,
            mtime: row.mtime,
        }
        const node: ChapterNode = { entry, order: readOrderPrefix(fileName) }
        const bucket = volumes.get(volumeDir)
        if (bucket === undefined) {
            volumes.set(volumeDir, [node])
        } else {
            bucket.push(node)
        }
    }
    const groups: PressVolumeGroup[] = [...volumes.entries()].map(([dirName, nodes]) => ({
        name: dirName.length === 0 ? '' : toDisplayName(dirName),
        dirName,
        chapters: [...nodes]
            .sort((left, right) =>
                compareByOrder(
                    { order: left.order, name: left.entry.title },
                    { order: right.order, name: right.entry.title },
                ),
            )
            .map((node) => node.entry),
    }))
    groups.sort((left, right) => {
        // 未分卷章节始终排在最前，其余按卷序号与卷名排序
        if (left.dirName.length === 0 || right.dirName.length === 0) {
            return left.dirName.length === 0 ? -1 : 1
        }
        return compareByOrder(
            { order: readOrderPrefix(left.dirName), name: left.name },
            { order: readOrderPrefix(right.dirName), name: right.name },
        )
    })
    return { project: aggregateProject(name, rows), volumes: groups }
}

/** 列出某卷下全部已登记文档路径：卷重命名后据此按新路径重建索引 */
export function listVolumeFilePaths(db: Database.Database, dirPath: string, volumeDir: string): string[] {
    const name = readProjectName(dirPath)
    if (name === null) {
        return []
    }
    // 新旧目录名各查一次：旧作品迁移前卷仍在 Chapter 下，只查新名会读不到卷内文件
    return CHAPTER_DIR_NAMES.flatMap((chapterDir) =>
        listPathsByPrefix(db, `${PRESS_MODULE_DIR}/${name}/${chapterDir}/${volumeDir}/`),
    )
}

/** 列出作品已有的章节路径：新建章节时据此计算下一个序号与落点卷 */
export function listProjectChapterPaths(db: Database.Database, dirPath: string): string[] {
    const name = readProjectName(dirPath)
    if (name === null) {
        return []
    }
    return CHAPTER_DIR_NAMES.flatMap((chapterDir) =>
        listPathsByPrefix(db, `${PRESS_MODULE_DIR}/${name}/${chapterDir}/`),
    )
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

/** 判断单份文档是否在索引库中：打开章节前回查，避免采信前端传入的任意路径 */
export function hasProjectFile(db: Database.Database, path: string): boolean {
    const row = db.prepare('SELECT 1 AS found FROM files WHERE path = ?').get(path) as { found: number } | undefined
    return row !== undefined
}
