/**
 * 作品文档回写：把工作台草稿对应的段落合并进 README、设定.md、角色设定.md、大纲.md。
 * 复用约定：路径解析与原文读取复用 projectWorkspace 与 common/storagePath，写盘统一走 vscode.workspace.fs。
 * 关键约束：只做段落级替换——README 仅改 Frontmatter 的四个字段，设定与大纲各替换一个固定标题的二级段落，
 * 角色块按一级标题匹配；用户手写的其它段落原样保留，单份文件写入失败不影响其余文件。
 */
import * as vscode from 'vscode'
import { PROJECT_README_NAME, PRESS_MODULE_DIR } from './projectFactory'
import { readProjectWorkspace } from './projectWorkspace'
import type { PressApplyMeta, PressApplyRequest } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri } from '../common/storagePath'

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

/**
 * 合并角色块：按一级标题匹配，同名整块替换，其余追加到文件末尾。
 * 关键约束：文件头提示（「# 角色设定」与其说明）不是角色块，匹配时按完整标题行精确比较。
 */
function mergeCharacterBlocks(current: string, blocks: PressApplyRequest['characters']): string {
    let lines = (current.trim().length > 0 ? current : '# 角色设定\n').split(/\r?\n/u)
    for (const block of blocks) {
        const heading = `# ${block.name}`
        const index = lines.findIndex((line) => line.trim() === heading)
        if (index === -1) {
            lines = [...lines, '', ...block.text.split('\n')]
            continue
        }
        let end = lines.length
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            if (/^#\s+/u.test(lines[cursor] ?? '')) {
                end = cursor
                break
            }
        }
        lines = [...lines.slice(0, index), ...block.text.split('\n'), '', ...lines.slice(end)]
    }
    return normalizeBlankLines(lines.join('\n')).trimEnd() + '\n'
}

/**
 * 回写作品文档：四份文件各自合并后写入，逐份兜住异常并返回实际写入的清单。
 * 安全约束：作品目录由 readProjectWorkspace 统一校验（press/ 下两段、拒绝上跳），写入路径不复用前端数据。
 */
export async function applyProjectWorkspace(payload: PressApplyRequest): Promise<{ written: string[] }> {
    const document = await readProjectWorkspace(payload.dirPath)
    const root = resolveStorageRoot()
    const toUri = (fileName: string): vscode.Uri => buildStorageUri(root, [PRESS_MODULE_DIR, document.name, fileName])
    const nextFiles: { fileName: string; content: string }[] = [
        { fileName: WORKSPACE_FILE_NAMES.readme, content: mergeReadmeFrontmatter(document.files.readme, payload.readme) },
        {
            fileName: WORKSPACE_FILE_NAMES.setting,
            content: replaceLevelTwoSection(document.files.setting, SETTING_SECTION_TITLE, payload.setting, '# 设定'),
        },
        {
            fileName: WORKSPACE_FILE_NAMES.characters,
            content: mergeCharacterBlocks(document.files.characters, payload.characters),
        },
        {
            fileName: WORKSPACE_FILE_NAMES.outline,
            content: replaceLevelTwoSection(document.files.outline, OUTLINE_SECTION_TITLE, payload.outline, '# 大纲'),
        },
    ]
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
    return { written }
}
