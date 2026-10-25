/**
 * 作品导入解析器：把已解码的纯文本切分为章节与卷，产出可直接落盘的标题、卷名与正文段落。
 * 复用约定：字数统计委托 common/db/fileMeta 的 countWords，与索引库口径完全一致；
 * 章节与卷的识别以行首标记为主、卷内序号连续性为辅，未命中任何标记时返回空列表交由调用方报错。
 * 关键约束：正文只做两处必要改动——每个非空行独立成段、行首 Markdown 块级符号（# - * > | 等）转全角，
 * 避免正文被渲染成标题、列表、引用或表格而破坏四区块结构与阅读观感；解析全程不抛错，异常以 warnings 回报；
 * 全文没有卷标记时章节统一落入「默认卷」，与作品骨架「章节一律在卷下」的布局保持一致。
 */

import { countWords } from '@modules/common/db/fileMeta'

/** 中文与阿拉伯数字字符集：卷号、章号与序号校验共用同一字符类 */
const NUMBER_CHARS = '0-9０-９零〇一二三四五六七八九十百千两壹贰叁肆伍陆柒捌玖拾佰仟'

/** 卷标记：第N卷 / 第N部 / 卷N，兼容「卷一 风起」这类省略「第」的写法 */
const VOLUME_MARK_PATTERN = new RegExp(`^(?:第\\s*[${NUMBER_CHARS}]+\\s*[卷部]|卷\\s*[${NUMBER_CHARS}]+)`, 'u')

/** 编号章节标记：第N章/回/节/话、Chapter N，捕获组为章号原文 */
const NUMBERED_CHAPTER_PATTERN = new RegExp(`^(?:第\\s*([${NUMBER_CHARS}]+)\\s*[章回节话]|Chapter\\s*(\\d+))`, 'iu')

/** 任意位置的编号章节标记：用于拆开「卷名与章名写在同一行」的标题 */
const CHAPTER_MARK_ANYWHERE_PATTERN = new RegExp(`第\\s*[${NUMBER_CHARS}]+\\s*[章回节话]`, 'u')

/** 无编号的特殊章节名：标号之后须为行尾或分隔符，避免命中以「序言」开头的正文句 */
const SPECIAL_CHAPTER_PATTERN =
    /^(?:楔子|序章|序言|序幕|引子|引言|尾声|终章|尾章|后记|番外(?:篇)?|外传)(?=$|[\s:：、.．·-])/u

/** 数字顿号标题：1、标题 / 001. 标题 */
const NUMBERED_LIST_PATTERN = /^(\d{1,4})\s*[、．.](?=\s*\S)/u

/** 标号与标题之间的分隔符：紧跟分隔符即视为强格式，不再要求序号连续 */
const LEADING_SEPARATOR_PATTERN = /^[\s:：、.．·-]+/u

/** 卷名尾部需要剥掉的分隔符 */
const TRAILING_SEPARATOR_PATTERN = /[\s:：、.．·-]+$/u

/** 标题行归一化时折叠的空白：含全角空格与制表符 */
const INLINE_SPACE_PATTERN = /\s+/gu

/** 全角数字码点偏移：归一化时统一转半角，让「第１２章」与「第12章」走同一套匹配 */
const FULLWIDTH_DIGIT_OFFSET = 0xfee0

/** 标题行长度上限：超过即视为正文句子 */
const MAX_HEADING_LENGTH = 60

/** 弱格式标题的最大长度：无分隔符时收紧判定，避免把正文句子当标题 */
const MAX_WEAK_HEADING_LENGTH = 30

/** 句末标点：出现即可判定为正文句子而非标题 */
const PROSE_PUNCTUATION_PATTERN = /[。；]/u

/** 引用式开头：紧跟标号即为「第三章的内容」这类正文引用，不是标题 */
const REFERENCE_PREFIX_PATTERN = /^(?:的|内容|情节|开头|结尾|标题|大纲)/u

/** 前导内容保留阈值：书名页、目录等短内容丢弃，超过该长度才作为「前言」保留 */
const PREAMBLE_KEEP_THRESHOLD = 200

/** 章节标题与卷名的长度上限：兼顾文件名可读性与 Windows 路径长度 */
const MAX_SEGMENT_LENGTH = 40

/** 文件名与目录名中不可出现的字符 */
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|]/gu

/** 行首块级符号的全角等价：转义后 Markdown 不再把该行识别为结构 */
const FULLWIDTH_SYMBOLS: Readonly<Record<string, string>> = {
    '#': '＃',
    '-': '－',
    '*': '＊',
    '+': '＋',
    '>': '＞',
    '|': '｜',
    _: '＿',
    '`': '｀',
    '~': '～',
    '=': '＝',
    '<': '＜',
    '[': '［',
}

/** 有序列表标记：数字 + 点或右括号 + 空白，点与括号须换成全角才能破坏语法 */
const ORDERED_LIST_PATTERN = /^(\d{1,9})([.)])(?:\s|$)/u

/** 其余行首块级语法：无序列表、分隔线、代码围栏、引用、表格、Setext 下划线、HTML 块与链接定义 */
const BLOCK_START_PATTERNS: readonly RegExp[] = [
    /^[-*+](?:\s|$)/u,
    /^([-*_])\1{2,}$/u,
    /^(?:`{3,}|~{3,})/u,
    /^>/u,
    /^\|/u,
    /^={2,}$/u,
    /^<[a-zA-Z/!]/u,
    /^\[[^\]]+\]:\s/u,
]

/** 全文没有卷标记时的兜底卷名：与作品骨架「章节一律在卷下」保持一致 */
const FALLBACK_VOLUME_NAME = '默认卷'

/** 中文数字符号到数值的映射：覆盖大小写与「两」等异体写法 */
const CHINESE_DIGITS: Readonly<Record<string, number>> = {
    零: 0,
    〇: 0,
    一: 1,
    壹: 1,
    二: 2,
    两: 2,
    贰: 2,
    三: 3,
    叁: 3,
    四: 4,
    肆: 4,
    五: 5,
    伍: 5,
    六: 6,
    陆: 6,
    七: 7,
    柒: 7,
    八: 8,
    捌: 8,
    九: 9,
    玖: 9,
}

/** 中文数字位权：只支持到千位，足以覆盖长篇连载的卷号与章号 */
const CHINESE_UNITS: Readonly<Record<string, number>> = {
    十: 10,
    拾: 10,
    百: 100,
    佰: 100,
    千: 1000,
    仟: 1000,
}

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
    /** 卷目录名（含两位序号前缀）：解析结果总带卷，无卷标记时归入默认卷 */
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

/** 全角数字转半角：编码探测后仍可能残留全角标号，统一后再匹配 */
function toHalfWidthDigits(value: string): string {
    return value.replace(/[０-９]/gu, (char) => {
        const code = char.codePointAt(0) ?? 0
        return String.fromCodePoint(code - FULLWIDTH_DIGIT_OFFSET)
    })
}

/** 标题行归一：全角数字转半角、连续空白（含全角空格）压成单个空格并去首尾 */
function normalizeHeadingLine(line: string): string {
    return toHalfWidthDigits(stripControlChars(line)).replace(INLINE_SPACE_PATTERN, ' ').trim()
}

/** 读取标号数值：阿拉伯数字直接转，中文数字按位权累加，无法解析返回 null */
function readNumberValue(raw: string): number | null {
    if (/^\d+$/u.test(raw)) {
        return Number.parseInt(raw, 10)
    }
    let section = 0
    let digit: number | null = null
    for (const char of raw) {
        const value = CHINESE_DIGITS[char]
        if (value !== undefined) {
            digit = value
            continue
        }
        const unit = CHINESE_UNITS[char]
        if (unit === undefined) {
            return null
        }
        section += (digit ?? 1) * unit
        digit = null
    }
    return section + (digit ?? 0)
}

/** 章节标号的格式强度：决定是否需要序号连续性校验才认作新章节 */
type MarkStrength = 'strong' | 'weak' | 'list'

/** 行首标题的识别结果：卷名与章节标题可能同时出现（「第一卷 风起 第一章 少年」） */
interface Heading {
    /** 卷可读名（已剥离卷标号），null 表示本行不是卷标记 */
    volumeName: string | null
    /** 章节标题（保留标号原文），null 表示本行不是章节标记 */
    chapterTitle: string | null
    /** 章节号：无编号的特殊章节名为 null，用于卷内序号连续性校验 */
    chapterNumber: number | null
    /** 格式强度：weak 为标号后直接接文字，list 为数字顿号，两者与正文同形，需序号校验 */
    strength: MarkStrength
}

/** 是否像正文句子：过长或含句末标点 */
function looksLikeProse(line: string): boolean {
    return line.length > MAX_HEADING_LENGTH || PROSE_PUNCTUATION_PATTERN.test(line)
}

/** 读取行首的章节标记：命中返回章号与格式强度，未命中返回 null */
function readChapterMark(text: string): { number: number | null; strength: MarkStrength } | null {
    const numbered = NUMBERED_CHAPTER_PATTERN.exec(text)
    if (numbered !== null) {
        const raw = numbered[1] ?? numbered[2] ?? ''
        const tail = text.slice(numbered[0].length)
        // 「第三章的内容」是对既有章节的引用，直接排除，避免正文被反复切段
        if (REFERENCE_PREFIX_PATTERN.test(tail.trim())) {
            return null
        }
        // 标号后紧跟分隔符说明标题与标号已分离，可放心切章；直接接文字则待序号校验
        const isSeparated = tail.length === 0 || LEADING_SEPARATOR_PATTERN.test(tail)
        return { number: readNumberValue(raw), strength: isSeparated ? 'strong' : 'weak' }
    }
    if (SPECIAL_CHAPTER_PATTERN.test(text)) {
        return { number: null, strength: 'strong' }
    }
    const listed = NUMBERED_LIST_PATTERN.exec(text)
    if (listed !== null) {
        // 「1、标题」与正文物件列表同形，须严格连续才认作章节
        return { number: readNumberValue(listed[1] ?? ''), strength: 'list' }
    }
    return null
}

/** 拆解一行标题：同时给出卷名与章节标题，便于处理同一行既分卷又分章的导出文本 */
function readHeading(line: string): Heading | null {
    if (line.length === 0 || looksLikeProse(line)) {
        return null
    }
    const volumeMatch = VOLUME_MARK_PATTERN.exec(line)
    if (volumeMatch !== null) {
        const afterVolume = line.slice(volumeMatch[0].length).replace(LEADING_SEPARATOR_PATTERN, '')
        const markIndex = afterVolume.search(CHAPTER_MARK_ANYWHERE_PATTERN)
        if (markIndex < 0) {
            // 「第一卷的结尾」是对卷的引用而非卷标题，按正文处理
            if (REFERENCE_PREFIX_PATTERN.test(afterVolume)) {
                return null
            }
            return {
                volumeName: afterVolume.replace(TRAILING_SEPARATOR_PATTERN, '').trim(),
                chapterTitle: null,
                chapterNumber: null,
                strength: 'strong',
            }
        }
        const chapterTitle = afterVolume.slice(markIndex).trim()
        const mark = readChapterMark(chapterTitle)
        return {
            volumeName: afterVolume.slice(0, markIndex).trim(),
            // 章部分是引用而非标题时只认卷，本行不再切段
            chapterTitle: mark === null ? null : chapterTitle,
            chapterNumber: mark?.number ?? null,
            strength: mark?.strength ?? 'strong',
        }
    }
    const mark = readChapterMark(line)
    if (mark === null) {
        return null
    }
    return { volumeName: null, chapterTitle: line, chapterNumber: mark.number, strength: mark.strength }
}

/**
 * 弱格式标题的可信度：强格式与无编号标题始终可信，避免误杀章节号重排或跳号的正常文本；
 * 标号直接接文字的按「章号向前推进」放行，数字顿号与正文物件列表同形，要求严格连续。
 */
function isReliableChapter(heading: Heading, lastChapterNumber: number): boolean {
    if (heading.chapterNumber === null || heading.strength === 'strong') {
        return true
    }
    if (heading.strength === 'list') {
        return heading.chapterNumber === lastChapterNumber + 1
    }
    return (
        heading.chapterNumber > lastChapterNumber &&
        heading.chapterTitle !== null &&
        heading.chapterTitle.length <= MAX_WEAK_HEADING_LENGTH
    )
}

/** 清洗为可用的文件名片段：去控制字符与非法字符、去首尾空白与结尾点，过长截断 */
export function sanitizeSegment(raw: string, maxLength = MAX_SEGMENT_LENGTH): string {
    const cleaned = stripControlChars(raw)
        .replace(ILLEGAL_SEGMENT_CHARS, ' ')
        .replace(INLINE_SPACE_PATTERN, ' ')
        .trim()
        .replace(/\.+$/u, '')
        .trim()
    if (cleaned.length === 0) {
        return ''
    }
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned
}

/** 把行首字符换成全角等价：只用于块级符号，转换后 Markdown 不再识别为结构 */
function escapeLeadingSymbol(line: string): string {
    const first = line.slice(0, 1)
    const replacement = FULLWIDTH_SYMBOLS[first]
    return replacement === undefined ? line : `${replacement}${line.slice(1)}`
}

/**
 * 破坏正文行首的 Markdown 块级语法：命中则返回转义后的行，未命中返回 null。
 * 只替换触发字符（标题井号、有序列表的点或括号、其余符号的首字符），其余排版原样保留。
 */
function escapeBlockSyntax(line: string): string | null {
    if (line.startsWith('#')) {
        return `＃${line.slice(1)}`
    }
    const ordered = ORDERED_LIST_PATTERN.exec(line)
    if (ordered !== null) {
        const digits = ordered[1] ?? ''
        const marker = (ordered[2] ?? '.') === ')' ? '）' : '．'
        return `${digits}${marker}${line.slice(digits.length + 1)}`
    }
    if (BLOCK_START_PATTERNS.some((pattern) => pattern.test(line))) {
        return escapeLeadingSymbol(line)
    }
    return null
}

/** 把正文行转为段落文本：每个非空行独立成段，行首块级符号转全角避免被渲染成结构 */
function buildBody(lines: string[], escapeCounter: { count: number }): string {
    const paragraphs: string[] = []
    for (const line of lines) {
        const trimmed = stripControlChars(line).trim()
        if (trimmed.length === 0) {
            continue
        }
        const escaped = escapeBlockSyntax(trimmed)
        if (escaped !== null) {
            escapeCounter.count += 1
            paragraphs.push(escaped)
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
    /** 当前卷内已出现的最新章号：弱格式标题的章号回退时按正文引用处理 */
    let lastChapterNumber = 0

    const flush = (): void => {
        if (current === null) {
            return
        }
        chapters.push(finalizeChapter(current, chapters.length + 1, escapeCounter))
        current = null
    }

    const applyVolume = (name: string): void => {
        flush()
        volumeOrder += 1
        lastChapterNumber = 0
        const cleaned = sanitizeSegment(name)
        const volumeName = cleaned.length > 0 ? cleaned : `卷${String(volumeOrder)}`
        currentVolumeDir = `${toOrderPrefix(volumeOrder)}-${volumeName}`
        if (!volumeDirs.includes(currentVolumeDir)) {
            volumeDirs.push(currentVolumeDir)
        }
    }

    for (const rawLine of text.split(/\r?\n/u)) {
        const heading = readHeading(normalizeHeadingLine(rawLine))
        if (heading !== null && heading.volumeName !== null) {
            applyVolume(heading.volumeName)
            if (heading.chapterTitle === null) {
                continue
            }
        }
        if (heading !== null && heading.chapterTitle !== null && isReliableChapter(heading, lastChapterNumber)) {
            flush()
            current = { title: heading.chapterTitle, volumeDir: currentVolumeDir, lines: [] }
            if (heading.chapterNumber !== null) {
                lastChapterNumber = heading.chapterNumber
            }
            continue
        }
        if (current === null) {
            preambleLines.push(rawLine)
            continue
        }
        current.lines.push(rawLine)
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
            // 前言不属于任何卷，落到首个卷下，避免在 Chapters 根目录出现散章
            volumeDir: volumeDirs[0] ?? currentVolumeDir,
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
    // 无卷标记的文本统一归入默认卷：作品骨架约定章节一律在卷下，避免根目录散章
    if (chapters.length > 0 && volumeDirs.length === 0) {
        const fallbackVolumeDir = `${toOrderPrefix(1)}-${FALLBACK_VOLUME_NAME}`
        for (const chapter of chapters) {
            chapter.volumeDir = fallbackVolumeDir
        }
        volumeDirs.push(fallbackVolumeDir)
        warnings.push(`未识别到卷标记，全部章节已归入「${FALLBACK_VOLUME_NAME}」`)
    }
    if (escapeCounter.count > 0) {
        warnings.push(
            `${String(escapeCounter.count)} 行以 Markdown 块级符号开头（# - * > | 等），已转全角，` +
                '避免被渲染成标题、列表、引用或表格',
        )
    }
    return { chapters, volumeDirs, totalChars, warnings }
}
