/**
 * 作品文档回写：把工作台草稿对应的段落合并进 README、设定.md、角色设定.md、大纲.md。
 * 复用约定：路径解析与原文读取复用 projectWorkspace 与 common/storagePath，写盘统一走 vscode.workspace.fs。
 * 关键约束：只做段落级替换——README 仅改 Frontmatter 的四个字段，设定与大纲各替换一个固定标题的二级段落，
 * 角色块按一级标题匹配；用户手写的其它段落原样保留，单份文件写入失败不影响其余文件。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri } from '@modules/common/storagePath'
import type {
    PressApplyMeta,
    PressApplyRequest,
    PressSnapshotFileKey,
    PressSnapshotTrigger,
    PressWorkspaceFiles,
} from '@shared/types/press'
import { PROJECT_README_NAME } from './projectFactory'
import { readProjectWorkspace } from './projectWorkspace'

/** 设定与大纲的回写落点：标题固定，解析端按全文件键值读取，位置不敏感 */
const SETTING_SECTION_TITLE = '提取设定'
const OUTLINE_SECTION_TITLE = '分卷规划'

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

/**
 * 合并 README 的 Frontmatter：只覆盖 title/audience/tags/wordGoal，其余键与正文保持原样。
 * 关键约束：原文件没有 Frontmatter 时新建；已有键按行替换，缺失键追加，避免重复键。
 */
function mergeReadmeFrontmatter(readme: string, meta: PressApplyMeta): string {
    const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(readme)
    const frontmatter = matched?.[1] ?? ''
    const body = matched === null ? readme : readme.slice(matched[0].length)
    const lines = frontmatter
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
    const setValue = (key: string, value: string): void => {
        const pattern = new RegExp(`^${key}\\s*:`, 'u')
        const index = lines.findIndex((line) => pattern.test(line))
        if (index >= 0) {
            lines[index] = `${key}: ${value}`
            return
        }
        lines.push(`${key}: ${value}`)
    }
    setValue('title', meta.title)
    setValue('audience', meta.audience)
    setValue('tags', meta.genres.join(', '))
    setValue('wordGoal', String(meta.wordGoal))
    const tail = body.replace(/^\n+/u, '')
    return `---\n${lines.join('\n')}\n---\n\n${tail}`
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

/** 定位一级标题块的结束行：下一个一级标题即终点，找不到则到文件末尾 */
function findBlockEnd(lines: readonly string[], headingIndex: number): number {
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
        if (/^#\s+/u.test(lines[cursor] ?? '')) {
            return cursor
        }
    }
    return lines.length
}

/**
 * 移除角色块：删除角色时按一级标题整块移除，其余角色与文件头保持原样。
 * 关键约束：只删标题完全一致且有对应角色块的段，标题不存在时跳过，避免误删相邻内容。
 */
function removeCharacterBlocks(current: string, names: readonly string[]): string {
    if (names.length === 0) {
        return current
    }
    let lines = current.split(/\r?\n/u)
    for (const name of names) {
        const heading = `# ${name}`
        const index = lines.findIndex((line) => line.trim() === heading)
        if (index === -1) {
            continue
        }
        lines = [...lines.slice(0, index), ...lines.slice(findBlockEnd(lines, index))]
    }
    return lines.join('\n')
}

/**
 * 合并角色块：按一级标题匹配，同名整块替换，其余追加到文件末尾。
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
        const heading = `# ${block.name}`
        const index = lines.findIndex((line) => line.trim() === heading)
        if (index === -1) {
            lines = [...lines, '', ...block.text.split('\n')]
            continue
        }
        lines = [...lines.slice(0, index), ...block.text.split('\n'), '', ...lines.slice(findBlockEnd(lines, index))]
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

/** 待写条目：保留文档键，写盘成功后据此拼出「变更后的完整四份文档」 */
interface PendingFile {
    key: PressSnapshotFileKey
    fileName: string
    content: string
}

/**
 * 回写作品文档：只写请求里带上的那几份，逐份兜住异常并返回实际写入的清单。
 * 即时保存每次只带一份段落，未带的文件保持原样；删除名单与角色块在同一次写入里生效。
 * 安全约束：作品目录由 readProjectWorkspace 统一校验（press/ 下两段、拒绝上跳），写入路径不复用前端数据。
 * 关键约束：钩子只在确有文件写入成功时触发，且只把写入成功的段落计入快照内容——
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
    if (payload.readme !== undefined) {
        nextFiles.push({
            key: 'readme',
            fileName: WORKSPACE_FILE_NAMES.readme,
            content: mergeReadmeFrontmatter(document.files.readme, payload.readme),
        })
    }
    if (payload.setting !== undefined) {
        nextFiles.push({
            key: 'setting',
            fileName: WORKSPACE_FILE_NAMES.setting,
            content: replaceLevelTwoSection(document.files.setting, SETTING_SECTION_TITLE, payload.setting, '# 设定'),
        })
    }
    const deletedNames = payload.deletedCharacterNames ?? []
    if (payload.characters !== undefined || deletedNames.length > 0) {
        nextFiles.push({
            key: 'characters',
            fileName: WORKSPACE_FILE_NAMES.characters,
            content: mergeCharacterBlocks(document.files.characters, payload.characters ?? [], deletedNames),
        })
    }
    if (payload.outline !== undefined) {
        nextFiles.push({
            key: 'outline',
            fileName: WORKSPACE_FILE_NAMES.outline,
            content: replaceLevelTwoSection(document.files.outline, OUTLINE_SECTION_TITLE, payload.outline, '# 大纲'),
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
            if (!written.includes(file.fileName)) {
                continue
            }
            files[file.key] = file.content
            trigger.add(file.key === 'readme' ? 'setting' : file.key)
        }
        try {
            await hooks.onWritten({ dirPath: payload.dirPath, files, trigger: [...trigger] })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`作品文档快照记录失败（不影响本次回写）：${payload.dirPath}（${message}）`)
        }
    }
    return { written }
}
