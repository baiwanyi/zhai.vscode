/**
 * 作品文档回写：把工作台草稿对应的段落合并进 README、世界观.md、金手指.md、
 * 势力.md、地点.md、物品.md、角色设定.md、大纲.md。
 * 复用约定：路径解析与原文读取复用 projectWorkspace 与 common/storagePath，写盘统一走 vscode.workspace.fs。
 * 关键约束：字段分组做段落级替换——README 改一级标题与「作品设定」段内的元信息字段，
 * 世界观与金手指各替换自己文档里的「提取设定」段落；
 * 大纲按功能模块分段替换（结构纲 / 伏笔线索为固定标题段落，卷段落按「第N卷」标题动态匹配），
 * 一次请求可带多段、同一文件只写一次，未带的段落与用户手写内容原样保留；
 * 段落终点始终是下一个一/二级标题，因此段内字段只能用三级及更深标题；
 * 资料条目与角色块按标题逐块合并（角色块新格式二级、旧文件一级，改名等价于删旧写新），未涉及的块原样保留；
 * 用户手写的其它段落原样保留，单份文件写入失败不影响其余文件；设定分组文档不进快照，只有四份主文档参与留版。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri } from '@modules/common/storagePath'
import { PRESS_OUTLINE_SECTION_KEYS } from '@shared/types/press'
import type {
    PressApplyBlock,
    PressApplyMeta,
    PressApplyRequest,
    PressOutlineSectionKey,
    PressSnapshotFileKey,
    PressSnapshotTrigger,
    PressWorkspaceFiles,
} from '@shared/types/press'
import {
    PROJECT_FACTION_DOC_NAME,
    PROJECT_ITEM_DOC_NAME,
    PROJECT_PLACE_DOC_NAME,
    PROJECT_POWER_DOC_NAME,
    PROJECT_README_NAME,
    PROJECT_WORLD_DOC_NAME,
} from './projectFactory'
import { readProjectWorkspace } from './projectWorkspace'

/** 设定分组的段落落点：基本信息写 README，世界观与金手指各写自己的文档 */
const BASIC_SECTION_TITLE = '作品设定'
const SETTING_SECTION_TITLE = '提取设定'

/**
 * 大纲段落落点表：键与 PressOutlineSectionKey 一一对应，值即 大纲.md 里的二级标题。
 * 关键约束：改动标题必须同步改解析端的段落关键词；
 * 卷纲与章节内容各自整段替换——卷名写在两段的三级标题里，前端一次提交两段即可保证同步；
 * 成长线是独立段落，按卷切块，与结构纲 / 伏笔线索互不覆盖；
 * 设定纲 / 节奏情绪 / 时间线已不在表内，旧文档里的这些段落不解析也不回写，原样保留。
 */
const OUTLINE_SECTION_TITLES: Readonly<Record<PressOutlineSectionKey, string>> = {
    structure: '结构纲',
    volumeOutlines: '卷纲',
    chapters: '章节内容',
    clues: '伏笔线索',
    growth: '成长线',
}

/** 四份文档文件名：与 projectFactory 的骨架命名保持一致 */
const WORKSPACE_FILE_NAMES = {
    readme: PROJECT_README_NAME,
    setting: '设定.md',
    characters: '角色设定.md',
    outline: '大纲.md',
} as const

/** 写文本文件：统一 UTF-8 编码，覆盖语义由调用方保证 */
async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
}

/** 整理空行：连续空行压成一个，避免多次回写后文件越长越松 */
function normalizeBlankLines(text: string): string {
    return text.replace(/\n{3,}/gu, '\n\n')
}

/** 在作品设定段内替换一个三级字段：值为空时整块删除，缺失时追加到段末 */
function setHeadingField(section: string, title: string, value: string): string {
    const lines = section.split(/\r?\n/u)
    const heading = `### ${title}`
    const index = lines.findIndex((line) => line.trim() === heading)
    if (index < 0 && value.length === 0) {
        return section
    }
    if (index < 0) {
        return `${section.trimEnd()}\n\n${heading}\n\n${value}`
    }
    let end = index + 1
    while (end < lines.length && !/^###\s+/u.test(lines[end] ?? '')) {
        end += 1
    }
    if (value.length === 0) {
        return [...lines.slice(0, index), ...lines.slice(end)].join('\n')
    }
    return [...lines.slice(0, index), heading, '', value, ...lines.slice(end)].join('\n')
}

/**
 * 把 README 元信息写进正文：标题写一级标题，目标读者 / 题材 / 目标字数写进「作品设定」段。
 * 关键约束：段落缺失时补建，字段存在时按块替换，空题材不写空壳；其余正文逐字保留。
 */
function mergeReadmeMeta(readme: string, meta: PressApplyMeta): string {
    const lines = readme.split(/\r?\n/u)
    const headingIndex = lines.findIndex((line) => /^#\s+/u.test(line))
    if (headingIndex >= 0) {
        lines[headingIndex] = `# ${meta.title}`
    }
    const text = lines.join('\n')
    const sectionPattern = new RegExp(`^##\\s+${BASIC_SECTION_TITLE}\\s*$`, 'mu')
    const matched = sectionPattern.exec(text)
    if (matched === null) {
        const fields = ([
            ['目标读者', meta.audience],
            ['题材', meta.genres.join('、')],
            ['目标字数', String(meta.wordGoal)],
        ] as const)
            .filter(([, value]) => value.length > 0)
            .map(([title, value]) => `### ${title}\n\n${value}`)
        return `${text.trimEnd()}\n\n## ${BASIC_SECTION_TITLE}\n\n${fields.join('\n\n')}\n`
    }
    const sectionStart = matched.index + matched[0].length
    const rest = text.slice(sectionStart)
    const nextSection = /^##\s+/mu.exec(rest)
    const sectionEnd = nextSection === null ? rest.length : nextSection.index
    let section = rest.slice(0, sectionEnd)
    section = setHeadingField(section, '目标读者', meta.audience)
    section = setHeadingField(section, '题材', meta.genres.join('、'))
    section = setHeadingField(section, '目标字数', String(meta.wordGoal))
    return `${text.slice(0, sectionStart)}${section}${text.slice(sectionStart + sectionEnd)}`
}

/**
 * 替换指定二级标题段落的正文：找不到该段落时追加到文末。
 * 段落终点取下一个一级或二级标题，保证只动目标段落、其它段落顺序不变。
 */
function replaceLevelTwoSection(text: string, title: string, body: string, fallbackHeading: string): string {
    const lines = (text.trim().length > 0 ? text : `${fallbackHeading}\n`).split(/\r?\n/u)
    const headingPattern = new RegExp(`^##\\s+${title}\\s*$`, 'u')
    const headingIndex = lines.findIndex((line) => headingPattern.test(line))
    if (headingIndex === -1) {
        return normalizeBlankLines(`${lines.join('\n').trimEnd()}\n\n## ${title}\n\n${body}\n`)
    }
    let end = lines.length
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
        if (/^#{1,2}\s+/u.test(lines[cursor] ?? '')) {
            end = cursor
            break
        }
    }
    const merged = [...lines.slice(0, headingIndex + 1), '', body, '', ...lines.slice(end)]
    return normalizeBlankLines(merged.join('\n')).trimEnd() + '\n'
}

/** 正则转义：角色名是作者输入，可能含括号与点等元字符 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * 定位角色块标题行与其级别：新格式是二级标题（块内三级分组、四级字段），旧文件是一级标题。
 * 关键约束：标题必须整行精确匹配，避免「薛牧」命中「薛牧之」这类前缀相同的角色。
 */
function findCharacterHeading(lines: readonly string[], name: string): { index: number; level: 1 | 2 } | null {
    const pattern = new RegExp(`^(#{1,2})\\s+${escapeRegExp(name)}\\s*$`, 'u')
    for (let index = 0; index < lines.length; index += 1) {
        const matched = pattern.exec((lines[index] ?? '').trim())
        if (matched?.[1] !== undefined) {
            return { index, level: matched[1].length === 1 ? 1 : 2 }
        }
    }
    return null
}

/** 角色块终点：一级块到下一个一级标题，二级块到下一个一/二级标题 */
function findCharacterBlockEnd(lines: readonly string[], headingIndex: number, level: 1 | 2): number {
    const endPattern = level === 1 ? /^#\s+/u : /^#{1,2}\s+/u
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
        if (endPattern.test(lines[cursor] ?? '')) {
            return cursor
        }
    }
    return lines.length
}

/**
 * 移除角色块：删除角色时整块移除，其余角色与文件头保持原样。
 * 关键约束：只删标题完全一致且有对应角色块的段，标题不存在时跳过，避免误删相邻内容；
 * 一级与二级标题都认，旧文件里尚未迁移的块也能删除。
 */
function removeCharacterBlocks(current: string, names: readonly string[]): string {
    if (names.length === 0) {
        return current
    }
    let lines = current.split(/\r?\n/u)
    for (const name of names) {
        const target = findCharacterHeading(lines, name)
        if (target === null) {
            continue
        }
        lines = [
            ...lines.slice(0, target.index),
            ...lines.slice(findCharacterBlockEnd(lines, target.index, target.level)),
        ]
    }
    return lines.join('\n')
}

/**
 * 合并角色块：同名整块替换，其余追加到文件末尾，旧的一级标题块就地升级为二级。
 * 关键约束：文件头提示（「# 角色设定」与其说明）不是角色块，匹配时按完整标题行精确比较；
 * 删除先于合并执行，因此「改名的角色」等价于删旧块 + 写新块。
 */
function mergeCharacterBlocks(
    current: string,
    blocks: NonNullable<PressApplyRequest['characters']>,
    deletedNames: readonly string[],
): string {
    const base = removeCharacterBlocks(current, deletedNames)
    let lines = (base.trim().length > 0 ? base : '# 角色设定\n').split(/\r?\n/u)
    for (const block of blocks) {
        const target = findCharacterHeading(lines, block.name)
        if (target === null) {
            lines = [...lines, '', ...block.text.split('\n')]
            continue
        }
        const end = findCharacterBlockEnd(lines, target.index, target.level)
        lines = [...lines.slice(0, target.index), ...block.text.split('\n'), '', ...lines.slice(end)]
    }
    return normalizeBlankLines(lines.join('\n')).trimEnd() + '\n'
}

/** 定位二级标题块的结束行：下一个一级或二级标题即终点，找不到则到文件末尾 */
function findLevelTwoBlockEnd(lines: readonly string[], headingIndex: number): number {
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
        if (/^#{1,2}\s+/u.test(lines[cursor] ?? '')) {
            return cursor
        }
    }
    return lines.length
}

/**
 * 合并二级标题条目块：文件抬头（一级标题与说明行）原样保留，
 * 同名 `## 名称` 块整块替换，新条目追加到文件末尾，删除名单先于合并执行。
 * 关键约束：只认完整标题行匹配，手写的其它条目不会被改写；
 * 文件不存在时按 header 建一份新文档，首次保存即可落盘。
 */
function mergeLevelTwoBlocks(
    current: string,
    blocks: readonly PressApplyBlock[],
    deletedNames: readonly string[],
    header: string,
): string {
    let lines = (current.trim().length > 0 ? current : `${header}\n`).split(/\r?\n/u)
    for (const name of deletedNames) {
        const heading = `## ${name}`
        const index = lines.findIndex((line) => line.trim() === heading)
        if (index === -1) {
            continue
        }
        lines = [...lines.slice(0, index), ...lines.slice(findLevelTwoBlockEnd(lines, index))]
    }
    for (const block of blocks) {
        const heading = `## ${block.name}`
        const index = lines.findIndex((line) => line.trim() === heading)
        if (index === -1) {
            lines = [...lines, '', ...block.text.split('\n')]
            continue
        }
        lines = [
            ...lines.slice(0, index),
            ...block.text.split('\n'),
            '',
            ...lines.slice(findLevelTwoBlockEnd(lines, index)),
        ]
    }
    return normalizeBlankLines(lines.join('\n')).trimEnd() + '\n'
}

/** 回写完成后的通知载荷：携带写盘后的四份文档全文与本次变更分区，供快照层直接留版 */
export interface WorkspaceWriteOutcome {
    dirPath: string
    files: PressWorkspaceFiles
    trigger: PressSnapshotTrigger[]
}

/** 回写钩子：快照记录失败不得影响已完成的文档回写，异常在本模块内兜住 */
export interface WorkspaceWriteHooks {
    onWritten?: (outcome: WorkspaceWriteOutcome) => Promise<void>
}

/** 待写条目：snapshotKey 为快照收录的文档键，设定分组文档不进快照，取 null */
interface PendingFile {
    snapshotKey: PressSnapshotFileKey | null
    fileName: string
    content: string
}

/**
 * 回写作品文档：只写请求里带上的那几份，逐份兜住异常并返回实际写入的清单。
 * 手动保存每次只带当前标签页对应的段落，未带的文件保持原样；删除名单与角色块在同一次写入里生效。
 * 安全约束：作品目录由 readProjectWorkspace 统一校验（press/ 下两段、拒绝上跳），写入路径不复用前端数据。
 * 关键约束：钩子只在四份主文档确有写入时触发，且只把写入成功的段落计入快照内容——
 * 某份文档写失败时磁盘仍是旧内容，快照若按新内容存档会造出一版并不存在的历史。
 */
export async function applyProjectWorkspace(
    payload: PressApplyRequest,
    hooks: WorkspaceWriteHooks = {},
): Promise<{ written: string[] }> {
    const document = await readProjectWorkspace(payload.dirPath)
    const root = resolveStorageRoot()
    const toUri = (fileName: string): vscode.Uri => buildStorageUri(root, [PRESS_MODULE_DIR, document.name, fileName])
    const nextFiles: PendingFile[] = []
    if (payload.readme !== undefined || payload.basic !== undefined) {
        // 基本信息与元信息同属 README：先替换正文段落，再把元信息写进正文，两者互不覆盖
        let content = document.files.readme
        if (payload.basic !== undefined) {
            content = replaceLevelTwoSection(content, BASIC_SECTION_TITLE, payload.basic, `# ${document.name}`)
        }
        if (payload.readme !== undefined) {
            content = mergeReadmeMeta(content, payload.readme)
        }
        nextFiles.push({
            snapshotKey: 'readme',
            fileName: WORKSPACE_FILE_NAMES.readme,
            content,
        })
    }
    if (payload.world !== undefined) {
        nextFiles.push({
            snapshotKey: null,
            fileName: PROJECT_WORLD_DOC_NAME,
            content: replaceLevelTwoSection(
                document.settingSections.world,
                SETTING_SECTION_TITLE,
                payload.world,
                '# 世界观',
            ),
        })
    }
    if (payload.power !== undefined) {
        nextFiles.push({
            snapshotKey: null,
            fileName: PROJECT_POWER_DOC_NAME,
            content: replaceLevelTwoSection(
                document.settingSections.power,
                SETTING_SECTION_TITLE,
                payload.power,
                '# 金手指',
            ),
        })
    }
    /** 条目文档的回写：块合并与删除名单一起生效，两者都没带时该文档保持原样 */
    const pushLoreFile = (
        fileName: string,
        header: string,
        current: string,
        blocks: PressApplyBlock[] | undefined,
        deletedNames: readonly string[],
    ): void => {
        if (blocks === undefined && deletedNames.length === 0) {
            return
        }
        nextFiles.push({
            snapshotKey: null,
            fileName,
            content: mergeLevelTwoBlocks(current, blocks ?? [], deletedNames, header),
        })
    }
    pushLoreFile(
        PROJECT_FACTION_DOC_NAME,
        '# 势力',
        document.settingSections.faction,
        payload.factions,
        payload.deletedFactionNames ?? [],
    )
    pushLoreFile(
        PROJECT_PLACE_DOC_NAME,
        '# 地点',
        document.settingSections.place,
        payload.places,
        payload.deletedPlaceNames ?? [],
    )
    pushLoreFile(
        PROJECT_ITEM_DOC_NAME,
        '# 物品',
        document.settingSections.item,
        payload.items,
        payload.deletedItemNames ?? [],
    )
    const deletedNames = payload.deletedCharacterNames ?? []
    if (payload.characters !== undefined || deletedNames.length > 0) {
        nextFiles.push({
            snapshotKey: 'characters',
            fileName: WORKSPACE_FILE_NAMES.characters,
            content: mergeCharacterBlocks(document.files.characters, payload.characters ?? [], deletedNames),
        })
    }
    if (payload.outlineSections !== undefined) {
        // 一次请求里可能带多个段落：在内存里逐段替换，最后只写一次文件，避免同文档多次写盘
        let content = document.files.outline
        const sections = payload.outlineSections
        for (const key of PRESS_OUTLINE_SECTION_KEYS) {
            const body = sections[key]
            if (body === undefined) {
                continue
            }
            content = replaceLevelTwoSection(content, OUTLINE_SECTION_TITLES[key], body, '# 大纲')
        }
        nextFiles.push({
            snapshotKey: 'outline',
            fileName: WORKSPACE_FILE_NAMES.outline,
            content,
        })
    }
    const written: string[] = []
    for (const file of nextFiles) {
        try {
            await writeTextFile(toUri(file.fileName), file.content)
            written.push(file.fileName)
        } catch (error) {
            logger.error(`作品文档回写失败：${payload.dirPath}/${file.fileName}`, error)
        }
    }
    logger.info(`作品文档回写完成：${payload.dirPath}，写入 ${written.join('、')}`)
    if (hooks.onWritten !== undefined && written.length > 0) {
        const files: PressWorkspaceFiles = { ...document.files }
        const trigger = new Set<PressSnapshotTrigger>()
        for (const file of nextFiles) {
            if (file.snapshotKey === null || !written.includes(file.fileName)) {
                continue
            }
            files[file.snapshotKey] = file.content
            trigger.add(file.snapshotKey === 'readme' ? 'setting' : file.snapshotKey)
        }
        // 只写了分组专属文档时四份主文档没有变化，不留版
        if (trigger.size > 0) {
            try {
                await hooks.onWritten({ dirPath: payload.dirPath, files, trigger: [...trigger] })
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn(`作品文档快照记录失败（不影响本次回写）：${payload.dirPath}（${message}）`)
            }
        }
    }
    return { written }
}
