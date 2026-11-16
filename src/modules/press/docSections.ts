/**
 * 作品文档分节：把设定 / 人物 / 大纲的 Markdown 按标题切成可引用的行区间。
 * 复用约定：路径构造与片段校验取 common/storagePath，文件名沿用 projectFactory 的骨架命名；
 * 返回行号为 1-based、含标题行与块末行，只给区间不带正文，正文在发送时按区间读取。
 * 关键约束：只读不写，dirPath 必须是 press/{作品名} 两段；文件缺失返回空数组而不是抛错，
 * 单个文档异常不应让上下文菜单整体失败；代码块内的 # 行不算标题。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import type { AiDocSection } from '@shared/types/aiChat'
import type { PressDocKey } from '@shared/types/press'
import {
    PROJECT_FACTION_DOC_NAME,
    PROJECT_ITEM_DOC_NAME,
    PROJECT_PLACE_DOC_NAME,
    PROJECT_POWER_DOC_NAME,
    PROJECT_README_NAME,
    PROJECT_WORLD_DOC_NAME,
} from './projectFactory'

/** 作品目录段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** 分节扫描的最低与最高标题层级：一级是文件抬头，不参与选取 */
const MIN_SECTION_LEVEL = 2
const MAX_SECTION_LEVEL = 4

/**
 * 文档键到文件名的映射：与 projectWorkspace 的工作台文档口径保持一致。
 * 角色设定与大纲未在 projectFactory 导出命名常量，改动时须与该文件同步。
 */
export const PRESS_DOC_FILE_NAMES: Readonly<Record<PressDocKey, string>> = {
    readme: PROJECT_README_NAME,
    world: PROJECT_WORLD_DOC_NAME,
    power: PROJECT_POWER_DOC_NAME,
    faction: PROJECT_FACTION_DOC_NAME,
    place: PROJECT_PLACE_DOC_NAME,
    item: PROJECT_ITEM_DOC_NAME,
    characters: '角色设定.md',
    outline: '大纲.md',
}

/** ATX 标题：只认行首的 # 序列，行尾闭合符号忽略 */
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/u

/** 代码围栏：围栏内的 # 行是注释而非标题，扫描时整段跳过 */
const FENCE_PATTERN = /^\s*(?:```|~~~)/u

interface HeadingEntry {
    title: string
    level: number
    /** 标题所在行号（1-based） */
    line: number
}

/** 收集标题：按出现顺序，不合并同名标题 */
function collectHeadings(lines: readonly string[]): HeadingEntry[] {
    const headings: HeadingEntry[] = []
    let isInFence = false
    lines.forEach((line, index) => {
        if (FENCE_PATTERN.test(line)) {
            isInFence = !isInFence
            return
        }
        if (isInFence) {
            return
        }
        const matched = HEADING_PATTERN.exec(line)
        if (matched === null) {
            return
        }
        const level = matched[1]?.length ?? 0
        const title = (matched[2] ?? '').trim()
        if (level < MIN_SECTION_LEVEL || level > MAX_SECTION_LEVEL || title.length === 0) {
            return
        }
        headings.push({ title, level, line: index + 1 })
    })
    return headings
}

/**
 * 按标题切分文档：块的终点是「下一个同级或更高级标题」的上一行，同级条目不会互相吞并。
 * 最后一个块一直落到文件末行，末尾空行不计入字数。
 */
export function splitDocSections(text: string): AiDocSection[] {
    const lines = text.split(/\r?\n/u)
    const headings = collectHeadings(lines)
    return headings.map((heading, index) => {
        let endLine = lines.length
        for (let next = index + 1; next < headings.length; next += 1) {
            const candidate = headings[next]
            if (candidate !== undefined && candidate.level <= heading.level) {
                endLine = candidate.line - 1
                break
            }
        }
        const body = lines.slice(heading.line - 1, endLine).join('\n').trimEnd()
        return {
            title: heading.title,
            level: heading.level as AiDocSection['level'],
            startLine: heading.line,
            endLine,
            charCount: body.length,
        }
    })
}

/** 读取文档原文：文件不存在或解码失败按空串处理，与工作台读取口径一致 */
async function readTextFile(uri: vscode.Uri): Promise<string> {
    try {
        const content = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(content)
    } catch {
        return ''
    }
}

/**
 * 读取某作品的文档分节：路径先经片段校验并限定为 press/ 下两段，再拼绝对 Uri。
 * 安全约束：doc 只能取 PressDocKey 白名单，文件名映射留在本文件，前端无法伪造文件名。
 */
export async function readDocSections(dirPath: string, doc: PressDocKey): Promise<AiDocSection[]> {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    const name = segments[1] ?? ''
    const uri = buildStorageUri(resolveStorageRoot(), [PRESS_MODULE_DIR, name, PRESS_DOC_FILE_NAMES[doc]])
    const text = await readTextFile(uri)
    return text.length === 0 ? [] : splitDocSections(text)
}
