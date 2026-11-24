/**
 * 章节事实读取：为「写后回填」提供章节文档的实际摘要、状态与字数。
 * 复用约定：卷章清单与字数取自索引库（readProjectDetail），章节摘要与状态直接解析文件 Frontmatter；
 * 路径构造走 common/storagePath 的片段校验与存储根拼装，与其它作品文档读取同一口径。
 * 关键约束：只读——不回写章节文件、不触发索引，回填写的是大纲；单个章节读取失败只让该章的摘要为空，
 * 不影响其余章节，避免一处文件被占用导致整次回填不可用。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import type { ClueRefsAnalyzeChapter, ClueRefsAnalyzeRequest, PressChapterFact } from '@shared/types/press'
import { readOrderPrefix } from './projectFactory'
import { readProjectDetail } from './projectRepository'
import type Database from 'better-sqlite3'

/** 作品目录段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** Frontmatter 里的标量值：去掉首尾引号，数组写法原样保留 */
function readFrontmatterValue(frontmatter: string, key: string): string {
    const pattern = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mu')
    const raw = pattern.exec(frontmatter)?.[1]?.trim() ?? ''
    return raw.replace(/^["']|["']$/gu, '')
}

/**
 * 解析章节 Frontmatter：只取回填需要的两个字段。
 * 关键约束：摘要允许写成数组或引号字符串，统一按文本返回，不在这里做业务解释。
 */
function parseChapterFrontmatter(text: string): { summary: string; status: string } {
    if (!text.startsWith('---')) {
        return { summary: '', status: '' }
    }
    const end = text.indexOf('\n---', 3)
    if (end < 0) {
        return { summary: '', status: '' }
    }
    const frontmatter = text.slice(3, end)
    return {
        summary: readFrontmatterValue(frontmatter, 'summary'),
        status: readFrontmatterValue(frontmatter, 'status'),
    }
}

/** 读取单章文本：文件缺失或读取失败按空串处理 */
async function readChapterText(root: vscode.Uri, relativePath: string): Promise<string> {
    try {
        const uri = buildStorageUri(root, toSafeSegments(relativePath, '章节'))
        const content = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(content)
    } catch {
        return ''
    }
}

/**
 * 读取作品的全部章节事实：按卷序与卷内位置返回，索引库缺失时返回空数组。
 * 安全约束：作品目录先校验为 press/ 下两段，章节路径同样经过片段校验后才拼 Uri。
 */
export async function readChapterFacts(db: Database.Database, dirPath: string): Promise<PressChapterFact[]> {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    const detail = readProjectDetail(db, dirPath)
    if (detail === null) {
        return []
    }
    const root = resolveStorageRoot()
    const facts: PressChapterFact[] = []
    for (const [volumeIndex, volume] of detail.volumes.entries()) {
        const volumeOrder = readOrderPrefix(volume.dirName) ?? volumeIndex + 1
        for (const [index, chapter] of volume.chapters.entries()) {
            const text = await readChapterText(root, chapter.path)
            const { summary, status } = parseChapterFrontmatter(text)
            facts.push({
                path: chapter.path,
                volumeDir: volume.dirName,
                volumeOrder,
                chapterIndex: index + 1,
                title: chapter.title,
                summary,
                status,
                wordCount: chapter.wordCount,
                mtime: chapter.mtime,
            })
        }
    }
    return facts
}

/** 单段摘录长度：首/中/尾各取这么多字，避免整章正文进入提示词 */
const CLUE_EXCERPT_LENGTH = 400
/** 识别入参上限：伏笔条数与各字段长度，防止提示词膨胀 */
const MAX_ANALYZE_CLUES = 40
const MAX_ANALYZE_CLUE_ID = 64
const MAX_ANALYZE_CLUE_NAME = 64
const MAX_ANALYZE_CLUE_NOTE = 300

/** 正文摘录：去掉 Frontmatter 后取首/中/尾三段，长章不整篇送入模型 */
function buildChapterExcerpt(text: string): string {
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
    const body = (end >= 0 ? text.slice(end + 4) : text).trim()
    if (body.length <= CLUE_EXCERPT_LENGTH * 3) {
        return body
    }
    const middleStart = Math.floor((body.length - CLUE_EXCERPT_LENGTH) / 2)
    return [
        body.slice(0, CLUE_EXCERPT_LENGTH),
        body.slice(middleStart, middleStart + CLUE_EXCERPT_LENGTH),
        body.slice(body.length - CLUE_EXCERPT_LENGTH),
    ].join('\n…\n')
}

/** 伏笔位置识别入参收窄：目录必填，伏笔按条数与字段长度截断，id 非空才保留 */
export function normalizeClueRefsAnalyzeRequest(payload: unknown): ClueRefsAnalyzeRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/aiAnalyzeClueRefs 缺少参数')
    }
    const value = payload as Record<string, unknown>
    if (typeof value.dirPath !== 'string' || value.dirPath.length === 0) {
        throw new Error('pressAi/aiAnalyzeClueRefs 参数非法：dirPath 须为非空字符串')
    }
    const rawClues = Array.isArray(value.clues) ? value.clues.slice(0, MAX_ANALYZE_CLUES) : []
    const clues = rawClues.flatMap((item) => {
        if (typeof item !== 'object' || item === null) {
            return []
        }
        const record = item as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.slice(0, MAX_ANALYZE_CLUE_ID) : ''
        if (id.length === 0) {
            return []
        }
        return [
            {
                id,
                name: typeof record.name === 'string' ? record.name.slice(0, MAX_ANALYZE_CLUE_NAME) : '',
                note: typeof record.note === 'string' ? record.note.slice(0, MAX_ANALYZE_CLUE_NOTE) : '',
            },
        ]
    })
    return { dirPath: value.dirPath, clues }
}

/**
 * 读取章节正文摘录：供 AI 识别伏笔的埋设与回收位置，只在用户主动识别时调用。
 * 安全约束：目录先按片段校验，坐标用章纲 order 与伏笔引用同口径；单章读取失败只留空摘录。
 */
export async function readChapterExcerpts(db: Database.Database, dirPath: string): Promise<ClueRefsAnalyzeChapter[]> {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    const detail = readProjectDetail(db, dirPath)
    if (detail === null) {
        return []
    }
    const root = resolveStorageRoot()
    const chapters: ClueRefsAnalyzeChapter[] = []
    for (const [volumeIndex, volume] of detail.volumes.entries()) {
        const volumeOrder = readOrderPrefix(volume.dirName) ?? volumeIndex + 1
        for (const [index, chapter] of volume.chapters.entries()) {
            const text = await readChapterText(root, chapter.path)
            chapters.push({
                volumeOrder,
                chapterOrder: 'order' in chapter && typeof chapter.order === 'number' ? chapter.order : index + 1,
                title: chapter.title,
                excerpt: buildChapterExcerpt(text),
            })
        }
    }
    return chapters
}
