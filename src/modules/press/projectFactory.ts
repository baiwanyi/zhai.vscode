/**
 * 作品骨架生成：作品名校验、目录常量与骨架文档模板的纯函数实现，零副作用便于单测。
 * 骨架对齐 docs/modules/press.md 1.2：README.md + 大纲.md + 角色设定.md + 设定.md + Chapter/。
 * 关键约束：作品名同时作为目录名，须满足跨平台约束（非法字符、系统保留名、首尾空格与点）；
 * 本模块只产出相对路径与内容，落盘与索引由 projectService 负责；README 的 Frontmatter title 供索引器取标题。
 */
import type { PressCategory } from '../../shared/types/press'

/** 作品所属模块的一级目录名，与存储根约定一致 */
export const PRESS_MODULE_DIR = 'press'

/** 作品根文档名：作品被打开时的落点，同时承载背景与风格设定 */
export const PROJECT_README_NAME = 'README.md'

/** 章节目录名：其下的文档计入章节数 */
export const PROJECT_CHAPTER_DIR = 'Chapter'

/** 作品名字符数上限：兼顾侧栏展示与文件系统路径长度 */
export const MAX_PROJECT_NAME_LENGTH = 60

/** Windows 保留设备名：这些名字作为目录名在 Windows 上不可创建 */
const WINDOWS_RESERVED_NAMES: readonly string[] = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
]

/** 文件名与目录名中不可出现的字符（Windows 与各平台通用的最小集合） */
const ILLEGAL_NAME_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|']

/** 骨架文档：relativePath 相对作品目录，content 为落盘全文 */
export interface ProjectSkeletonFile {
    relativePath: string
    content: string
}

/** 是否含控制字符：不可见字符会污染文件系统与展示 */
function hasControlChar(value: string): boolean {
    return [...value].some((char) => char.charCodeAt(0) < 32)
}

/**
 * 校验作品名：合法返回 null，非法返回可直接展示给用户的原因。
 * 关键约束：先 trim 再校验；空名、超长、非法字符、控制字符、`.`/`..`、
 * 首空格或以空格/点结尾、Windows 保留名（含以扩展名形式出现的变体）一律拒绝。
 */
export function validateProjectName(name: string): string | null {
    if (name.length === 0) {
        return '作品名不能为空'
    }
    if (name.length > MAX_PROJECT_NAME_LENGTH) {
        return `作品名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    }
    if (ILLEGAL_NAME_CHARS.some((char) => name.includes(char)) || hasControlChar(name)) {
        return '作品名不能包含 \\ / : * ? " < > | 等非法字符'
    }
    if (name === '.' || name === '..') {
        return '作品名不能为 . 或 ..'
    }
    if (name.startsWith(' ') || name.endsWith(' ') || name.endsWith('.')) {
        return '作品名不能以空格开头，也不能以空格或点结尾'
    }
    const baseName = (name.split('.')[0] ?? '').toUpperCase()
    if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
        return `作品名不能使用系统保留名：${name}`
    }
    return null
}

/** 本地日期字符串（YYYY-MM-DD），作为 Frontmatter 的创建日期 */
function toDateString(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

/** 作品根文档：Frontmatter 承载分类、状态与目标字数，正文留给用户补背景与风格 */
function buildReadmeContent(name: string, category: PressCategory, createdAt: string): string {
    return [
        '---',
        `title: ${name}`,
        `category: ${category}`,
        'status: ongoing',
        'wordGoal: 0',
        `createdAt: ${createdAt}`,
        '---',
        '',
        `# ${name}`,
        '',
        '## 简介',
        '',
        '## 写作风格',
        '',
    ].join('\n')
}

/** 生成作品骨架文件清单：顺序固定，README 始终在首位 */
export function buildProjectSkeleton(name: string, category: PressCategory, now: Date): ProjectSkeletonFile[] {
    return [
        { relativePath: PROJECT_README_NAME, content: buildReadmeContent(name, category, toDateString(now)) },
        { relativePath: '大纲.md', content: '# 大纲\n\n## 主线\n\n## 分卷规划\n' },
        {
            relativePath: '角色设定.md',
            content: '# 角色设定\n\n> 每个角色以一级标题起条，便于以 [[角色设定#角色名]] 引用。\n',
        },
        { relativePath: '设定.md', content: '# 设定\n\n## 世界观\n\n## 地理\n\n## 组织势力\n' },
    ]
}
