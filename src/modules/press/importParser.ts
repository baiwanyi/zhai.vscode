/**
 * 作品导入解析器：把已解码的纯文本切分为章节与卷，产出可直接落盘的标题、卷名与正文段落。
 * 复用约定：字数统计委托 common/db/fileMeta 的 countWords，与索引库口径完全一致；
 * 章节与卷的识别只依据行首正则，不做语义猜测，未命中任何标记时返回空列表交由调用方报错。
 * 关键约束：正文只做两处必要改动——每个非空行独立成段、行首 # 转全角，
 * 避免 Markdown 把正文首行当成标题破坏四区块结构；解析全程不抛错，异常以 warnings 回报。
 */

import { countWords } from '../common/db/fileMeta'

/** 章节起始行：第N章/回/节、Chapter N、数字加顿号，按顺序尝试，命中即止 */
const CHAPTER_PATTERNS: readonly RegExp[] = [
    /^\s*第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回节]/u,
    /^\s*Chapter\s*\d+/iu,
    /^\s*[0-9]{1,4}[、．]\s*\S/u,
]

/** 卷起始行：只认「第N卷」「第N部」，与章节标记互斥 */
const VOLUME_PATTERN = /^\s*第\s*[0-9零一二三四五六七八九十百]+?\s*[卷部]/u

/** 前导内容保留阈值：书名页、目录等短内容丢弃，超过该长度才作为「前言」保留 */
const PREAMBLE_KEEP_THRESHOLD = 200

/** 章节标题与卷名的长度上限：兼顾文件名可读性与 Windows 路径长度 */
const MAX_SEGMENT_LENGTH = 40

/** 文件名与目录名中不可出现的字符 */
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|]/gu

/**
 * 剔除控制字符：会污染文件系统与展示。
 * 用码点判断而非正则字符区间，与 projectFactory 的 hasControlChar 保持同一口径。
 */
function stripControlChars(value: string): string {
    return [...value]
        .filter((char) => {
            const code = char.codePointAt(0) ?? 0
            return code >= 0x20 && code !== 0x7f
        })
        .join('')
}

/** 单个章节的解析结果 */
export interface ParsedChapter {
    /** 全局序号，从 1 开始，决定文件名前缀与排序 */
    order: number
    /** 卷目录名（含两位序号前缀）；空串表示未分卷，直接落在 Chapters/ 下 */
    volumeDir: string
    /** 章节标题：保留原文写法，用于 Frontmatter 与一级标题 */
    title: string
    /** 正文段落：段落之间以空行分隔 */
    body: string
    /** 正文字符数：与索引库口径一致 */
    charCount: number
}

/** 整本小说的解析结果 */
export interface ParsedNovel {
    chapters: ParsedChapter[]
    /** 出现过的卷目录名，按原文顺序去重 */
    volumeDirs: string[]
    /** 全书正文字符数（含被丢弃的前导内容，便于核对是否有内容丢失） */
    totalChars: number
    /** 解析告警：前导内容丢弃、标题转义等，逐条展示给用户 */
    warnings: string[]
}

/** 两位序号前缀：与 projectFactory 的文件命名规则保持一致 */
function toOrderPrefix(order: number): string {
    return String(order).padStart(2, '0')
}

/** 是否为章节起始行 */
function isChapterTitle(line: string): boolean {
    return CHAPTER_PATTERNS.some((pattern) => pattern.test(line))
}

/** 是否为卷起始行 */
function isVolumeTitle(line: string): boolean {
    return VOLUME_PATTERN.test(line)
}

/** 清洗为可用的文件名片段：去控制字符与非法字符、去首尾空白与结尾点，过长截断 */
export function sanitizeSegment(raw: string, maxLength = MAX_SEGMENT_LENGTH): string {
    const cleaned = stripControlChars(raw)
        .replace(ILLEGAL_SEGMENT_CHARS, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/\.+$/u, '')
        .trim()
    if (cleaned.length === 0) {
        return ''
    }
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned
}

/** 提取卷可读名：去掉「第N卷」前缀，剩下为空时回退为「卷N」 */
function readVolumeName(title: string, order: number): string {
    const stripped = title.replace(/^\s*第\s*[0-9零一二三四五六七八九十百]+?\s*[卷部]\s*/u, '')
    const name = sanitizeSegment(stripped)
    return name.length > 0 ? name : `卷${order}`
}

/** 章节标题归一：只去控制字符与首尾空白，保留原文写法；为空时用序号兜底 */
function readChapterTitle(line: string, order: number): string {
    const cleaned = stripControlChars(line).trim()
    return cleaned.length > 0 ? cleaned : `第${order}章`
}

/** 把正文行转为段落文本：每个非空行独立成段，行首 # 转全角避免被当成标题 */
function buildBody(lines: string[], escapeCounter: { count: number }): string {
    const paragraphs: string[] = []
    for (const line of lines) {
        const trimmed = stripControlChars(line).trim()
        if (trimmed.length === 0) {
            continue
        }
        if (trimmed.startsWith('#')) {
            escapeCounter.count += 1
            paragraphs.push(`＃${trimmed.slice(1)}`)
            continue
        }
        paragraphs.push(trimmed)
    }
    return paragraphs.join('\n\n')
}

/** 累积中的章节：正文行先缓存，遇到下一个标记再成型 */
interface DraftChapter {
    title: string
    volumeDir: string
    lines: string[]
}

/** 把累积章节成型为解析结果 */
function finalizeChapter(draft: DraftChapter, order: number, escapeCounter: { count: number }): ParsedChapter {
    const body = buildBody(draft.lines, escapeCounter)
    return {
        order,
        volumeDir: draft.volumeDir,
        title: draft.title,
        body,
        charCount: countWords(body),
    }
}

/**
 * 解析整本小说：卷标记改变后续章节的落点，章节标记切段，其余行归入当前章正文。
 * 首个章节标记之前的内容视为前导（书名页、目录），超过阈值才保留为「前言」，
 * 否则丢弃并把字数计入 warnings，保证用户能看出丢了多少内容。
 */
export function parseNovel(text: string): ParsedNovel {
    const warnings: string[] = []
    const escapeCounter = { count: 0 }
    const chapters: ParsedChapter[] = []
    const volumeDirs: string[] = []
    const preambleLines: string[] = []
    let current: DraftChapter | null = null
    let currentVolumeDir = ''
    let volumeOrder = 0

    const flush = (): void => {
        if (current === null) {
            return
        }
        chapters.push(finalizeChapter(current, chapters.length + 1, escapeCounter))
        current = null
    }

    for (const line of text.split(/\r?\n/u)) {
        if (isVolumeTitle(line)) {
            flush()
            volumeOrder += 1
            const volumeName = readVolumeName(line, volumeOrder)
            currentVolumeDir = `${toOrderPrefix(volumeOrder)}-${volumeName}`
            if (!volumeDirs.includes(currentVolumeDir)) {
                volumeDirs.push(currentVolumeDir)
            }
            continue
        }
        if (isChapterTitle(line)) {
            flush()
            current = { title: readChapterTitle(line, chapters.length + 1), volumeDir: currentVolumeDir, lines: [] }
            continue
        }
        if (current === null) {
            preambleLines.push(line)
            continue
        }
        current.lines.push(line)
    }
    flush()

    const preambleBody = buildBody(preambleLines, escapeCounter)
    const preambleChars = countWords(preambleBody)
    let totalChars = preambleChars
    for (const chapter of chapters) {
        totalChars += chapter.charCount
    }
    if (preambleChars > PREAMBLE_KEEP_THRESHOLD) {
        const preamble: ParsedChapter = {
            order: 1,
            volumeDir: '',
            title: '前言',
            body: preambleBody,
            charCount: preambleChars,
        }
        chapters.unshift(preamble)
        // 前言占用序号 1，其余章节整体后移，保证文件名前缀连续
        chapters.forEach((chapter, index) => {
            chapter.order = index + 1
        })
        warnings.push(`首个章节标题之前有 ${String(preambleChars)} 字，已保留为「前言」`)
    } else if (preambleChars > 0) {
        warnings.push(`首个章节标题之前有 ${String(preambleChars)} 字（书名页或目录），已跳过`)
    }
    if (escapeCounter.count > 0) {
        warnings.push(`${String(escapeCounter.count)} 行以 # 开头，已转为全角＃避免被识别为标题`)
    }
    return { chapters, volumeDirs, totalChars, warnings }
}
