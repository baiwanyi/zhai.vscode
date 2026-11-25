/**
 * 大纲追加同步：仪表盘在作品列表新增卷 / 章节后，把对应章纲补写进「大纲.md」的「章节内容」段落。
 * 复用约定：路径校验与 Uri 构造取 common/storagePath 与 common/config，
 * 卷名与章标题归一取 projectFactory 的 toDisplayName。
 * 关键约束：单向同步——只补写作品列表新增的卷章，删除卷章不回改大纲，大纲的章节数允许多于作品列表；
 * 卷名与章名都不带卷号 / 章号，卷按名称对齐、章序按块的位置判断，判重口径是「卷内章块数」；
 * 章节区缺卷时补 `### 卷名`，卷纲区缺同名卷时补一个只有标题的空卷纲，保证两段卷名对齐；
 * 兼容仍带「第N卷」前缀的存量文档（匹配时先剥前缀）；
 * 写入失败只记日志，已落盘的章节文件不受影响。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import { toDisplayName } from './projectFactory'

/** 大纲文档名与两个分区标题：与 workspaceWriter / Webview 序列化口径保持一致 */
export const OUTLINE_FILE_NAME = '大纲.md'
const VOLUME_OUTLINE_SECTION_TITLE = '卷纲'
const CHAPTER_CONTENT_SECTION_TITLE = '章节内容'

/** 文档为空时的最小骨架 */
const OUTLINE_HEADER = '# 大纲'

/** 作品目录段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** 新章占位值：与工作台解析端的缺省口径一致（单章目标字数 2500、张力 3） */
const FALLBACK_CHAPTER_TITLE = '未命名章节'
const FALLBACK_CHAPTER_WORD_GOAL = 2500
const FALLBACK_TENSION = 3

/** 结构纲 / 卷纲 / 章节内容都是二级段落；卷是三级标题，章是四级标题 */
const LEVEL_TWO_OR_UP_PATTERN = /^#{1,2}\s+/u
const LEVEL_THREE_OR_UP_PATTERN = /^#{1,3}\s+/u
const VOLUME_OUTLINE_SECTION_PATTERN = /^##\s+卷纲\s*$/u
const CHAPTER_CONTENT_SECTION_PATTERN = /^##\s+章节内容\s*$/u
const VOLUME_HEADING_PATTERN = /^###\s+(.+)$/u
const CHAPTER_HEADING_PATTERN = /^####\s+(.+)$/u

/** 标题里的章序：仅用于兼容仍带「第N章」前缀的存量文档 */
const CHAPTER_ORDER_PATTERN = /第\s*(\d+)\s*章/u

/** 存量文档的卷名前缀：「第N卷 」在新文档里不再写，匹配时先剥掉 */
const VOLUME_ORDER_PREFIX_PATTERN = /^第\s*[0-9一二三四五六七八九十百]+\s*卷\s*/u

/** 待补写的章：卷目录名带序号前缀，章标题沿用作品列表口径（可带两位序号前缀） */
export interface OutlineChapterSeed {
    /** 卷目录名（含序号前缀）；空串表示历史散章 */
    volumeDir: string
    /** 卷内章序，与作品列表的编号一致 */
    order: number
    /** 章标题：作品列表口径，序号前缀在本模块剥离 */
    title: string
}

/** 读取作品名：目录须为 press/ 下两段，写入路径不复用前端数据 */
function readProjectName(dirPath: string): string {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    return segments[1] ?? ''
}

/** 读取原文：文件不存在或解码失败按空串处理，首次同步时按骨架补建 */
async function readTextFile(uri: vscode.Uri): Promise<string> {
    try {
        const content = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(content)
    } catch {
        return ''
    }
}

/** 去掉「第N卷」前缀：卷名来自目录的可读部分，避免与宿主补的卷序重复 */
function stripVolumePrefix(name: string): string {
    return name.replace(/^第\s*\d+\s*卷\s*/u, '').trim()
}

/** 去掉序号前缀与「第N章」前缀：章号在标题行里只出现一次，避免「第1章 01 未命名章节」 */
function stripChapterPrefix(title: string): string {
    return toDisplayName(title).replace(CHAPTER_ORDER_PATTERN, '').trim()
}

/** 单章块：标题只写纯章名（章序由块的位置决定），其余键值行与解析端口径一致 */
function buildChapterBlock(title: string): string {
    return [
        `#### ${title}`,
        '- 钩子：无',
        `- 张力：${String(FALLBACK_TENSION)}`,
        `- 字数：0/${String(FALLBACK_CHAPTER_WORD_GOAL)}`,
        '- 地点：',
    ].join('\n')
}

/** 定位块终点：遇到指定层级的标题即结束，找不到则落到文件末尾 */
function findBlockEnd(lines: readonly string[], headingIndex: number, pattern: RegExp): number {
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
        if (pattern.test(lines[cursor] ?? '')) {
            return cursor
        }
    }
    return lines.length
}

/** 插入位置：跳过块尾的空行，避免多次追加后文件越长越松 */
function findInsertIndex(lines: readonly string[], end: number, floor: number): number {
    let insertAt = end
    while (insertAt > floor && (lines[insertAt - 1] ?? '').trim().length === 0) {
        insertAt -= 1
    }
    return insertAt
}

/** 找二级段落标题行：不存在返回 -1 */
function findSectionHeading(lines: readonly string[], pattern: RegExp): number {
    return lines.findIndex((line) => pattern.test(line.trim()))
}

/** 卷名比较键：剥掉存量文档里可能残留的「第N卷」前缀，新文档只有纯卷名 */
function volumeKey(title: string): string {
    return title.replace(VOLUME_ORDER_PREFIX_PATTERN, '').trim()
}

/** 段落内按卷名找三级卷标题行：同名卷取第一个命中 */
function findVolumeHeading(lines: readonly string[], start: number, end: number, volumeName: string): number {
    const target = volumeKey(volumeName)
    for (let cursor = start; cursor < end; cursor += 1) {
        const matched = VOLUME_HEADING_PATTERN.exec((lines[cursor] ?? '').trim())
        if (matched?.[1] === undefined) {
            continue
        }
        if (volumeKey(matched[1]) === target) {
            return cursor
        }
    }
    return -1
}

/** 卷块内的章块数量：章号不再写进标题，章序由块的位置决定 */
function countChapters(lines: readonly string[], start: number, end: number): number {
    let count = 0
    for (let cursor = start; cursor < end; cursor += 1) {
        if (CHAPTER_HEADING_PATTERN.test((lines[cursor] ?? '').trim())) {
            count += 1
        }
    }
    return count
}

/** 收尾整理：连续空行压成一个，保证文件以单个换行结束 */
function normalizeOutline(text: string): string {
    return `${text.replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}

/**
 * 保证卷纲区有这一卷的三级标题：缺段落时补段落，缺卷时补一个只有标题的空卷纲。
 * 只补标题、不写占位字段，作者在大纲页看到空卷纲即可自行填写。
 */
function ensureVolumeOutlineTitle(text: string, volumeName: string): string {
    const lines = text.split(/\r?\n/u)
    const sectionHeading = findSectionHeading(lines, VOLUME_OUTLINE_SECTION_PATTERN)
    if (sectionHeading === -1) {
        return [...lines, '', `## ${VOLUME_OUTLINE_SECTION_TITLE}`, '', `### ${volumeName}`].join('\n')
    }
    const sectionEnd = findBlockEnd(lines, sectionHeading, LEVEL_TWO_OR_UP_PATTERN)
    if (findVolumeHeading(lines, sectionHeading + 1, sectionEnd, volumeName) !== -1) {
        return text
    }
    const insertAt = findInsertIndex(lines, sectionEnd, sectionHeading + 1)
    return [...lines.slice(0, insertAt), '', `### ${volumeName}`, '', ...lines.slice(insertAt)].join('\n')
}

/**
 * 把一章合并进大纲原文：章节区缺段落补段落、缺卷补卷标题、卷内缺章序时插入章块；
 * 卷纲区缺同名卷时一并补空卷纲标题，保证两段卷序对齐。
 * 返回 null 表示无需写盘（该卷内已有同章序的章纲），调用方据此跳过写文件。
 */
function mergeChapterIntoOutline(current: string, seed: OutlineChapterSeed): string | null {
    const volumeName = seed.volumeDir.length > 0 ? stripVolumePrefix(toDisplayName(seed.volumeDir)) : '默认卷'
    const chapterTitle = stripChapterPrefix(seed.title)
    const chapterBlock = buildChapterBlock(chapterTitle.length > 0 ? chapterTitle : FALLBACK_CHAPTER_TITLE)

    const base = current.trim().length > 0 ? current : OUTLINE_HEADER
    const withVolumeOutline = ensureVolumeOutlineTitle(base, volumeName)
    const lines = withVolumeOutline.split(/\r?\n/u)
    const sectionHeading = findSectionHeading(lines, CHAPTER_CONTENT_SECTION_PATTERN)

    if (sectionHeading === -1) {
        return normalizeOutline(
            [...lines, '', `## ${CHAPTER_CONTENT_SECTION_TITLE}`, '', `### ${volumeName}`, '', chapterBlock].join('\n'),
        )
    }

    const sectionEnd = findBlockEnd(lines, sectionHeading, LEVEL_TWO_OR_UP_PATTERN)
    const volumeHeading = findVolumeHeading(lines, sectionHeading + 1, sectionEnd, volumeName)
    if (volumeHeading === -1) {
        const insertAt = findInsertIndex(lines, sectionEnd, sectionHeading + 1)
        return normalizeOutline(
            [...lines.slice(0, insertAt), '', `### ${volumeName}`, '', chapterBlock, '', ...lines.slice(insertAt)].join(
                '\n',
            ),
        )
    }

    const volumeEnd = findBlockEnd(lines, volumeHeading, LEVEL_THREE_OR_UP_PATTERN)
    // 章号不进标题：卷内已有章块数达到本次章序，说明这一章已在文档里，跳过以避免重复插入
    if (countChapters(lines, volumeHeading + 1, volumeEnd) >= seed.order) {
        return null
    }
    const insertAt = findInsertIndex(lines, volumeEnd, volumeHeading + 1)
    return normalizeOutline([...lines.slice(0, insertAt), '', chapterBlock, '', ...lines.slice(insertAt)].join('\n'))
}

/**
 * 把作品列表新增的一章补写进大纲「章节内容」里对应卷的末尾。
 * 关键约束：只补大纲、不索引（watcher 会收录），章已存在时返回 false 且不触碰文件；
 * 入参卷目录名与章标题只读，序号从章文件名推导由调用方负责。
 */
export async function appendChapterToOutline(dirPath: string, seed: OutlineChapterSeed): Promise<boolean> {
    const projectName = readProjectName(dirPath)
    const root = resolveStorageRoot()
    const target = buildStorageUri(root, [PRESS_MODULE_DIR, projectName, OUTLINE_FILE_NAME])
    const current = await readTextFile(target)
    const next = mergeChapterIntoOutline(current, seed)
    if (next === null) {
        logger.debug(`大纲已存在该章纲，跳过同步：${dirPath} 第${String(seed.order)}章`)
        return false
    }
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(next))
    logger.info(`已同步新章到大纲：${dirPath} 第${String(seed.order)}章`)
    return true
}

/** 大纲章块的只读视图：章节事实与摘要回填共用，行号用于定位写回点 */
export interface OutlineChapterBlock {
    /** 所属卷名（已剥序号前缀） */
    volumeName: string
    /** 章块标题 */
    title: string
    /** 卷内位置（1 基） */
    indexInVolume: number
    /** 计划梗概 */
    summary: string
    /** 章标题行号 */
    headingLine: number
    /** 「计划梗概」五级标题行号，缺失为 null */
    summaryHeadingLine: number | null
    /** 「计划梗概」段结束行号（不含） */
    summaryEndLine: number | null
    /** 章块结束行号（不含） */
    blockEndLine: number
}

/**
 * 解析大纲「章节内容」段的全部章块：按卷分组、卷内按出现顺序编号。
 * 关键约束：只读解析；字段只取章标题下的键值行与「计划梗概」段，
 * 节拍与场景等更深标题不参与，避免把示例文字当成摘要。
 */
export function readOutlineChapterBlocks(outline: string): OutlineChapterBlock[] {
    const lines = outline.split(/\r?\n/u)
    const sectionStart = findSectionHeading(lines, CHAPTER_CONTENT_SECTION_PATTERN)
    if (sectionStart === -1) {
        return []
    }
    const sectionEnd = findBlockEnd(lines, sectionStart, LEVEL_TWO_OR_UP_PATTERN)
    const blocks: OutlineChapterBlock[] = []
    let volumeName = ''
    let chapterIndex = 0
    let current: OutlineChapterBlock | null = null
    let isInSummary = false
    const flush = (): void => {
        if (current !== null) {
            blocks.push(current)
            current = null
        }
    }
    const closeBlock = (line: number): void => {
        if (current !== null) {
            current.blockEndLine = line
            if (isInSummary) {
                current.summaryEndLine = line
            }
        }
        flush()
        isInSummary = false
    }
    for (let cursor = sectionStart + 1; cursor < sectionEnd; cursor += 1) {
        const line = (lines[cursor] ?? '').trim()
        const volumeMatch = VOLUME_HEADING_PATTERN.exec(line)
        if (volumeMatch !== null) {
            closeBlock(cursor)
            volumeName = volumeKey(volumeMatch[1] ?? '')
            chapterIndex = 0
            continue
        }
        const chapterMatch = CHAPTER_HEADING_PATTERN.exec(line)
        if (chapterMatch !== null) {
            closeBlock(cursor)
            chapterIndex += 1
            current = {
                volumeName,
                title: chapterMatch[1]?.trim() ?? '',
                indexInVolume: chapterIndex,
                summary: '',
                headingLine: cursor,
                summaryHeadingLine: null,
                summaryEndLine: null,
                blockEndLine: sectionEnd,
            }
            continue
        }
        if (current === null) {
            continue
        }
        if (/^#####\s+/u.test(line)) {
            if (isInSummary) {
                current.summaryEndLine = cursor
            }
            isInSummary = line.includes('计划梗概')
            if (isInSummary) {
                current.summaryHeadingLine = cursor
            }
            continue
        }
        if (/^#{1,4}\s+/u.test(line)) {
            current.blockEndLine = cursor
            if (isInSummary) {
                current.summaryEndLine = cursor
            }
            isInSummary = false
            continue
        }
        if (isInSummary && line.length > 0) {
            current.summary = current.summary.length > 0 ? `${current.summary}\n${line}` : line
        }
    }
    closeBlock(sectionEnd)
    return blocks
}

/**
 * 把归纳摘要写入大纲对应章块的「计划梗概」：已有内容或章号对不上时返回 null。
 * 关键约束：只补空段，不覆盖作者已写的梗概；改写后由调用方一次落盘并重建索引。
 */
export function mergeChapterSummaryIntoOutline(outline: string, order: number, summary: string): string | null {
    const normalized = summary.replace(/\s+/gu, ' ').trim()
    if (normalized.length === 0) {
        return null
    }
    const block = readOutlineChapterBlocks(outline)[order - 1]
    if (block === undefined || block.summary.trim().length > 0) {
        return null
    }
    const lines = outline.split(/\r?\n/u)
    if (block.summaryHeadingLine !== null && block.summaryEndLine !== null) {
        lines.splice(block.summaryHeadingLine + 1, 0, '', normalized)
    } else {
        lines.splice(block.blockEndLine, 0, '', '##### 计划梗概', '', normalized, '')
    }
    return normalizeOutline(lines.join('\n'))
}
