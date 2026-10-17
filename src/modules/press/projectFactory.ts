/**
 * 作品骨架生成：作品名校验、章节与卷的命名规则、骨架与章节文档模板，纯函数零副作用便于单测。
 * 骨架对齐 docs/modules/press.md 1.2/1.3：README.md + 大纲.md + 角色设定.md + 设定.md + Chapter/；
 * 章节文件按「两位序号-标题.md」命名，分卷目录按「两位序号-卷名」命名。
 * 关键约束：作品名同时作为目录名，须满足跨平台约束（非法字符、系统保留名、首尾空格与点）；
 * 本模块只产出相对路径与内容，落盘与索引由 projectService 负责；README 的 Frontmatter title 供索引器取标题；
 * 新作品自带卷1 与首章，保证详情页一进去就有可写章节，不留空态。
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
 * 名称通用校验：合法返回 null，非法返回可直接展示给用户的原因（label 用于拼装文案）。
 * 关键约束：调用方须先 trim；空名、超长、非法字符、控制字符、`.`/`..`、
 * 首空格或以空格/点结尾、Windows 保留名（含以扩展名形式出现的变体）一律拒绝。
 */
function validateName(name: string, label: string): string | null {
    if (name.length === 0) {
        return `${label}不能为空`
    }
    if (name.length > MAX_PROJECT_NAME_LENGTH) {
        return `${label}不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    }
    if (ILLEGAL_NAME_CHARS.some((char) => name.includes(char)) || hasControlChar(name)) {
        return `${label}不能包含 \\ / : * ? " < > | 等非法字符`
    }
    if (name === '.' || name === '..') {
        return `${label}不能为 . 或 ..`
    }
    if (name.startsWith(' ') || name.endsWith(' ') || name.endsWith('.')) {
        return `${label}不能以空格开头，也不能以空格或点结尾`
    }
    const baseName = (name.split('.')[0] ?? '').toUpperCase()
    if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
        return `${label}不能使用系统保留名：${name}`
    }
    return null
}

/** 校验作品名：同时作为目录名，规则与卷名一致，仅文案不同 */
export function validateProjectName(name: string): string | null {
    return validateName(name, '作品名')
}

/** 校验卷名：只用于卷目录名的可读部分，序号前缀由宿主保留 */
export function validateVolumeName(name: string): string | null {
    return validateName(name, '卷名')
}

/**
 * 生成重命名后的卷目录名：保留原目录的序号前缀，替换可读部分。
 * 原目录无序号前缀时新目录也不带前缀，避免凭空造出排序号。
 */
export function buildRenamedVolumeDirName(currentDirName: string, name: string): string {
    const matched = /^(\d+)(?:[-_.、\s])/.exec(currentDirName)
    return matched?.[1] === undefined ? name : `${matched[1]}-${name}`
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

/** 生成作品骨架文件清单：顺序固定，README 始终在首位，卷1 首章在末位 */
export function buildProjectSkeleton(name: string, category: PressCategory, now: Date): ProjectSkeletonFile[] {
    return [
        { relativePath: PROJECT_README_NAME, content: buildReadmeContent(name, category, toDateString(now)) },
        { relativePath: '大纲.md', content: '# 大纲\n\n## 主线\n\n## 分卷规划\n' },
        {
            relativePath: '角色设定.md',
            content: '# 角色设定\n\n> 每个角色以一级标题起条，便于以 [[角色设定#角色名]] 引用。\n',
        },
        { relativePath: '设定.md', content: '# 设定\n\n## 世界观\n\n## 地理\n\n## 组织势力\n' },
        {
            relativePath: `${PROJECT_CHAPTER_DIR}/${DEFAULT_VOLUME_DIR}/${buildChapterFileName(DEFAULT_VOLUME_ORDER)}`,
            content: buildChapterSkeleton(DEFAULT_VOLUME_ORDER),
        },
    ]
}

/** 章节文件名的序号位数：两位补零，超过 99 自然进位 */
const CHAPTER_ORDER_WIDTH = 2

/** 新建章节的默认标题 */
export const DEFAULT_CHAPTER_TITLE = '未命名章节'

/** 序号前缀：01-卷名、01-章节名.md 等，前缀后接分隔符或直接结束 */
const ORDER_PREFIX_PATTERN = /^(\d+)(?:[-_.、\s]|$)/

/** 参与序号排序的名称：order 为序号前缀，缺失为 null */
export interface OrderedName {
    order: number | null
    name: string
}

/** 读取名称的序号前缀：无前缀或非数字返回 null，缺失前缀的条目排序时置于有序项之后 */
export function readOrderPrefix(value: string): number | null {
    const matched = ORDER_PREFIX_PATTERN.exec(value)
    if (matched?.[1] === undefined) {
        return null
    }
    const parsed = Number.parseInt(matched[1], 10)
    return Number.isNaN(parsed) ? null : parsed
}

/** 按序号前缀升序：有序项在前按数值比较，无序号项在后按名称本地化比较，保证列表稳定 */
export function compareByOrder(left: OrderedName, right: OrderedName): number {
    if (left.order !== null && right.order !== null && left.order !== right.order) {
        return left.order - right.order
    }
    if (left.order !== null && right.order === null) {
        return -1
    }
    if (left.order === null && right.order !== null) {
        return 1
    }
    return left.name.localeCompare(right.name, 'zh')
}

/** 去掉序号前缀与 Markdown 扩展名，得到可直接展示的名称（章节名、卷名共用） */
export function toDisplayName(value: string): string {
    const withoutExtension = value.replace(/\.md$/i, '')
    const stripped = withoutExtension.replace(ORDER_PREFIX_PATTERN, '').trim()
    return stripped.length > 0 ? stripped : withoutExtension
}

/** 生成章节文件名：{两位序号}-未命名章节.md */
export function buildChapterFileName(order: number): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-${DEFAULT_CHAPTER_TITLE}.md`
}

/**
 * 生成重排序号后的章节文件名：保留可读部分，仅替换序号前缀。
 * 用途：跨卷移动章节时按目标卷重排，可读名与正文标题都不改动。
 */
export function buildOrderedChapterFileName(order: number, displayName: string): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-${displayName}.md`
}

/** 生成卷目录名：{两位序号}-卷{N} */
export function buildVolumeDirName(order: number): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-卷${order}`
}

/** 生成卷展示名：卷{N} */
export function buildVolumeTitle(order: number): string {
    return `卷${order}`
}

/** 默认卷序号：作品创建时即生成卷1 */
export const DEFAULT_VOLUME_ORDER = 1

/** 默认卷目录名：作品骨架创建与「无卷时章节落点」共用同一来源 */
export const DEFAULT_VOLUME_DIR = buildVolumeDirName(DEFAULT_VOLUME_ORDER)

/** 生成章节展示标题：{两位序号} 未命名章节 */
export function buildChapterTitle(order: number): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')} ${DEFAULT_CHAPTER_TITLE}`
}

/** 生成章节文档体：Frontmatter + 本章介绍 / 正文 / 出场角色 / 金手指设定（press.md 1.3） */
export function buildChapterSkeleton(order: number): string {
    const title = buildChapterTitle(order)
    return [
        '---',
        `title: ${title}`,
        'status: draft',
        'summary:',
        'characters: []',
        'goldenFingers: []',
        'wordGoal: 0',
        '---',
        '',
        `# ${title}`,
        '',
        '## 本章介绍',
        '',
        '## 正文',
        '',
        '## 出场角色',
        '',
        '## 金手指设定',
        '',
    ].join('\n')
}
