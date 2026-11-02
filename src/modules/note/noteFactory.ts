/**
 * 笔记草稿生成：按「年月目录 + 标题即文件名」产出空笔记的路径与内容。
 * 纯函数、零副作用，供 noteService 落盘、重命名服务与单元测试复用。
 * 关键约束：文件名直接取标题，仅做合法化收口（非法字符、保留名、长度与空标题回退），
 * 使「文件名 = 标题」成为可比较的稳定事实；新建笔记不写 Frontmatter，标题只由一级标题承载，
 * 索引器按「Frontmatter title → 首个一级标题 → 文件名」回落提取。
 */

/** 笔记在存储根下的一级目录名 */
export const NOTE_DIR = 'notes'

/** 空笔记的默认标题：标题为空或清洗后无内容时的文件名回退，也是默认标题的序号前缀 */
export const DEFAULT_NOTE_TITLE = '未命名笔记'

/** 文件名中不可用的字符：Windows 非法集与控制字符（\p{Cc}），统一置为空格后再折叠 */
const ILLEGAL_FILE_NAME_PATTERN = /[\\/:*?"<>|\p{Cc}]/gu

/** 文件名主体的最大字符数：中文按 3 字节估算，60 字约 180 字节，仍在 255 字节上限内 */
const MAX_FILE_NAME_LENGTH = 60

/** Windows 保留设备名：即便带 .md 后缀也不能作文件名 */
const RESERVED_FILE_NAMES: ReadonlySet<string> = new Set([
    'con',
    'prn',
    'aux',
    'nul',
    ...['com', 'lpt'].flatMap((prefix) => Array.from({ length: 9 }, (_, index) => `${prefix}${String(index + 1)}`)),
])

/** 第 index 篇未命名笔记的标题：序号从 1 开始，与文件名同源 */
export function buildDefaultNoteTitle(index: number): string {
    return `${DEFAULT_NOTE_TITLE} ${String(index)}`
}

/**
 * 标题转文件名：非法字符与结尾点去掉、连续空白折叠、超长截断，空标题与保留名走回退。
 * 调用方拿到的即可直接落盘，也可与磁盘上的现有文件名逐字比较，判断「文件名是否已跟随标题」。
 */
export function toNoteFileName(title: string): string {
    const collapsed = title
        .replace(ILLEGAL_FILE_NAME_PATTERN, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        // Windows 不允许文件名以点结尾，标题里的句末标点需先剥掉再截断
        .replace(/\.+$/u, '')
        .trim()
    const clipped = collapsed.slice(0, MAX_FILE_NAME_LENGTH).trim()
    const base = clipped.length === 0 ? DEFAULT_NOTE_TITLE : clipped
    const guarded = RESERVED_FILE_NAMES.has(base.toLowerCase()) ? `${base} ${DEFAULT_NOTE_TITLE}` : base
    return `${guarded}.md`
}

/** 相对存储根的年月目录，形如 notes/202610 */
export function buildNoteDirectory(now: Date): string {
    const month = String(now.getMonth() + 1).padStart(2, '0')
    return `${NOTE_DIR}/${now.getFullYear()}${month}`
}

/** 空笔记内容：仅一级标题 + 末尾换行作为光标落点，落地即可书写，不写 Frontmatter */
export function buildNoteContent(title: string): string {
    return `# ${title}\n`
}

/** 笔记草稿：落盘所需的全部信息，path 与索引库 files.path 同口径 */
export interface NoteDraft {
    path: string
    directory: string
    fileName: string
    title: string
    content: string
}

/** 生成一份空笔记草稿：文件名取自标题，正文保留标题原文（不做文件名合法化改写） */
export function createNoteDraft(now: Date, title: string = buildDefaultNoteTitle(1)): NoteDraft {
    const fileName = toNoteFileName(title)
    const directory = buildNoteDirectory(now)
    return {
        path: `${directory}/${fileName}`,
        directory,
        fileName,
        title,
        content: buildNoteContent(title),
    }
}
