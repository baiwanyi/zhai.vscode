/**
 * 模型写入文档的规范化：按文档类型补齐 Frontmatter 缺失字段，正文与已有键保持原样。
 * 复用约定：Frontmatter 拆解走 common/db/fileMeta 的 splitFrontmatter，标题取值与标量序列化沿用作品骨架。
 * 关键约束：只补缺失键、不覆盖已有值 —— 模型写好的简介与角色不能被宿主改回默认；
 * 存储根以外的路径原样返回，章节与 README 之外的文档不做任何改动。
 */
import { resolveStorageRoot } from '@modules/common/config'
import { splitFrontmatter } from '@modules/common/db/fileMeta'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { formatFrontmatterScalar, PROJECT_CHAPTER_DIR, PROJECT_README_NAME, toDisplayName } from './projectFactory'

/** 相对存储根的路径：不在存储根内返回 null，在根自身返回空串 */
function toStorageRelative(filePath: string): string | null {
    const root = resolveStorageRoot().path.replace(/\\/gu, '/').toLowerCase()
    const normalized = filePath.replace(/\\/gu, '/')
    const lower = normalized.toLowerCase()
    if (lower === root) {
        return ''
    }
    if (!lower.startsWith(`${root}/`)) {
        return null
    }
    return normalized.slice(root.length + 1)
}

/** 键值行：值为空时不留尾随空格，与骨架输出一致 */
function formatLine(key: string, value: string): string {
    return value.length > 0 ? `${key}: ${value}` : `${key}:`
}

/**
 * 合并默认 Frontmatter：已有键一律保留，只追加缺失项。
 * 关键约束：正文区间原样保留（splitFrontmatter 的 body 含前导换行），拼接时不得再补换行。
 */
function mergeDefaults(content: string, defaults: Record<string, string>): string {
    const { frontmatter, body } = splitFrontmatter(content)
    const entries = Object.entries(defaults)
    if (frontmatter.trim().length === 0) {
        const lines = entries.map(([key, value]) => formatLine(key, value))
        return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\r?\n/u, '')}`
    }
    const present = new Set(
        frontmatter
            .split(/\r?\n/u)
            .map((line) => line.split(':')[0]?.trim() ?? '')
            .filter((key) => key.length > 0),
    )
    const missing = entries.filter(([key]) => !present.has(key)).map(([key, value]) => formatLine(key, value))
    if (missing.length === 0) {
        return content
    }
    return `---\n${frontmatter}\n${missing.join('\n')}\n---${body}`
}

/** 章节文档的默认 Frontmatter：标题取自文件名，其余与新建章节一致 */
function chapterDefaults(fileName: string): Record<string, string> {
    return {
        title: formatFrontmatterScalar(toDisplayName(fileName), false),
        status: 'draft',
        summary: '',
        characters: '[]',
        goldenFingers: '[]',
        wordGoal: '0',
    }
}

/** README 的默认 Frontmatter：audience 属于枚举，缺失时不猜，交由用户设定 */
function readmeDefaults(projectName: string): Record<string, string> {
    return {
        title: formatFrontmatterScalar(projectName, false),
        status: 'ongoing',
        wordGoal: '0',
    }
}

/**
 * 规范化模型写入的 Markdown：章节补章节字段、README 补作品字段，其余文档原样返回。
 * 返回值为应落盘的内容，调用方需把它替换进工具入参的 content。
 */
export function normalizeWrittenDocument(filePath: string, content: string): string {
    if (!filePath.toLowerCase().endsWith('.md')) {
        return content
    }
    const relative = toStorageRelative(filePath)
    if (relative === null || relative.length === 0) {
        return content
    }
    const segments = relative.split('/')
    if (segments[0] !== PRESS_MODULE_DIR || segments.length < 3) {
        return content
    }
    const projectName = segments[1] ?? ''
    const fileName = segments[segments.length - 1] ?? ''
    const directory = segments[2] ?? ''
    if (projectName.length === 0) {
        return content
    }
    if (directory === PROJECT_CHAPTER_DIR) {
        return mergeDefaults(content, chapterDefaults(fileName))
    }
    if (segments.length === 3 && fileName === PROJECT_README_NAME) {
        return mergeDefaults(content, readmeDefaults(projectName))
    }
    return content
}
