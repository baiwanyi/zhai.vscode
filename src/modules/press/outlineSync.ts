/**
 * 大纲追加同步：仪表盘在作品列表新增卷 / 章节后，把对应章纲补写进「大纲.md」的「分卷规划」段落。
 * 复用约定：路径校验与 Uri 构造取 common/storagePath 与 common/config，
 * 卷序号、卷名与章标题归一取 projectFactory 的 readOrderPrefix / toDisplayName。
 * 关键约束：单向同步——只补写作品列表新增的卷章，删除卷章不回改大纲，大纲的章节数允许多于作品列表；
 * 判重口径是「卷序号 + 卷内章序」，重复调用不会重复插入；段落、卷块缺失时按工作台序列化口径补建，
 * 因此补写后的文档能被工作台的解析端原样读回；写入失败只记日志，已落盘的章节文件不受影响。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import { readOrderPrefix, toDisplayName } from './projectFactory'

/** 大纲文档名与段落标题：与 workspaceWriter 的落点保持一致 */
const OUTLINE_FILE_NAME = '大纲.md'
const PLAN_SECTION_TITLE = '分卷规划'

/** 文档为空时的最小骨架：一级标题留给文件抬头，段落统一挂在二级 */
const OUTLINE_HEADER = '# 大纲'

/** 作品目录段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** 新章占位值：与工作台解析端的缺省口径一致（单章目标字数 2500、张力 3） */
const FALLBACK_CHAPTER_TITLE = '未命名章节'
const FALLBACK_CHAPTER_WORD_GOAL = 2500
const FALLBACK_TENSION = 3

/** 标题层级：大纲段落二级、卷三级、章四级 */
const LEVEL_TWO_OR_UP_PATTERN = /^#{1,2}\s+/u
const LEVEL_THREE_OR_UP_PATTERN = /^#{1,3}\s+/u
const PLAN_SECTION_PATTERN = /^##\s+分卷规划\s*$/u
const VOLUME_HEADING_PATTERN = /^###\s+(.+)$/u
const CHAPTER_HEADING_PATTERN = /^####\s+(.+)$/u

/** 标题里的卷序与章序：工作台与宿主都按「第N卷 / 第N章」前缀识别层级 */
const VOLUME_ORDER_PATTERN = /第\s*(\d+)\s*卷/u
const CHAPTER_ORDER_PATTERN = /第\s*(\d+)\s*章/u

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

/** 单章块：键顺序与 serialize 的 buildChapterBlock 一致，空值行解析端会忽略 */
function buildChapterBlock(order: number, title: string): string {
    return [
        `#### 第${String(order)}章 ${title}`,
        '- 状态：待写',
        '- 梗概：',
        '- 钩子：无',
        `- 张力：${String(FALLBACK_TENSION)}`,
        `- 字数：0/${String(FALLBACK_CHAPTER_WORD_GOAL)}`,
        '- 地点：',
    ].join('\n')
}

/** 整卷块：卷纲四项留空由作者补写，章块紧随其后 */
function buildVolumeBlock(volumeOrder: number, volumeName: string, chapterBlock: string): string {
    return [
        `### 第${String(volumeOrder)}卷 ${volumeName}`,
        '- 卷目标：',
        '- 卷冲突：',
        '- 情节脉络：',
        '- 关键转折：',
        '',
        chapterBlock,
    ].join('\n')
}

/** 定位段落 / 卷块的终点行：遇到同级或更高级标题即结束，找不到则落到文件末尾 */
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

/** 段落内按卷序找卷标题行：认「第N卷」前缀，读不到卷序的卷不参与匹配 */
function findVolumeHeading(lines: readonly string[], start: number, end: number, volumeOrder: number): number {
    for (let cursor = start; cursor < end; cursor += 1) {
        const matched = VOLUME_HEADING_PATTERN.exec((lines[cursor] ?? '').trim())
        if (matched?.[1] === undefined) {
            continue
        }
        const order = VOLUME_ORDER_PATTERN.exec(matched[1])?.[1]
        if (order !== undefined && Number.parseInt(order, 10) === volumeOrder) {
            return cursor
        }
    }
    return -1
}

/** 卷块内是否已有该章序：按四级标题里的「第N章」判重，重复调用即幂等 */
function hasChapterOrder(lines: readonly string[], start: number, end: number, order: number): boolean {
    for (let cursor = start; cursor < end; cursor += 1) {
        const matched = CHAPTER_HEADING_PATTERN.exec((lines[cursor] ?? '').trim())
        if (matched?.[1] === undefined) {
            continue
        }
        const chapterOrder = CHAPTER_ORDER_PATTERN.exec(matched[1])?.[1]
        if (chapterOrder !== undefined && Number.parseInt(chapterOrder, 10) === order) {
            return true
        }
    }
    return false
}

/** 收尾整理：连续空行压成一个，保证文件以单个换行结束 */
function normalizeOutline(text: string): string {
    return `${text.replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}

/**
 * 把一章合并进大纲原文：段落缺失补段落、卷块缺失补卷块、章已存在则不动。
 * 返回 null 表示无需写盘（该卷内已有同章序的章纲），调用方据此跳过写文件。
 */
function mergeChapterIntoOutline(current: string, seed: OutlineChapterSeed): string | null {
    const volumeOrder = readOrderPrefix(seed.volumeDir) ?? 1
    const volumeName = seed.volumeDir.length > 0 ? stripVolumePrefix(toDisplayName(seed.volumeDir)) : '默认卷'
    const chapterTitle = stripChapterPrefix(seed.title)
    const chapterBlock = buildChapterBlock(seed.order, chapterTitle.length > 0 ? chapterTitle : FALLBACK_CHAPTER_TITLE)

    const text = current.trim().length > 0 ? current : OUTLINE_HEADER
    const lines = text.split(/\r?\n/u)
    const sectionHeading = lines.findIndex((line) => PLAN_SECTION_PATTERN.test(line.trim()))
    if (sectionHeading === -1) {
        const next = [
            ...lines,
            '',
            `## ${PLAN_SECTION_TITLE}`,
            '',
            buildVolumeBlock(volumeOrder, volumeName, chapterBlock),
        ]
        return normalizeOutline(next.join('\n'))
    }

    const sectionEnd = findBlockEnd(lines, sectionHeading, LEVEL_TWO_OR_UP_PATTERN)
    const volumeHeading = findVolumeHeading(lines, sectionHeading + 1, sectionEnd, volumeOrder)
    if (volumeHeading === -1) {
        const insertAt = findInsertIndex(lines, sectionEnd, sectionHeading + 1)
        const volumeBlock = buildVolumeBlock(volumeOrder, volumeName, chapterBlock)
        const next = [...lines.slice(0, insertAt), '', volumeBlock, '', ...lines.slice(insertAt)]
        return normalizeOutline(next.join('\n'))
    }

    const volumeEnd = findBlockEnd(lines, volumeHeading, LEVEL_THREE_OR_UP_PATTERN)
    if (hasChapterOrder(lines, volumeHeading + 1, volumeEnd, seed.order)) {
        return null
    }
    const insertAt = findInsertIndex(lines, volumeEnd, volumeHeading + 1)
    const next = [...lines.slice(0, insertAt), '', chapterBlock, '', ...lines.slice(insertAt)]
    return normalizeOutline(next.join('\n'))
}

/**
 * 把作品列表新增的一章补写进大纲的「分卷规划」段落。
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
