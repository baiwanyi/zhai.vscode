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
import type { PressChapterFact } from '@shared/types/press'
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
