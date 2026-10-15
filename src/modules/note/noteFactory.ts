/**
 * 笔记草稿生成：按「年月目录 + 打散时间戳的 UUID 文件名」产出空笔记的路径与内容。
 * 纯函数、零副作用，供 noteService 落盘与单元测试复用；目录规则见 docs/modules/notes.md 1.1。
 * 关键约束：ID 的时间戳位以固定步长打散分布，降低同日笔记文件名的可预测性；
 * 标题只由一级标题承载，不写 Frontmatter title，索引器按「Frontmatter title → 首个一级标题 → 文件名」回落提取。
 */
import { randomInt } from 'node:crypto'

/** 笔记在存储根下的一级目录名 */
export const NOTE_DIR = 'notes'

/** 空笔记的默认标题 */
export const DEFAULT_NOTE_TITLE = '未命名笔记'

/** ID 的十六进制总位数（对应 8-4-4-4-12 分组） */
const ID_HEX_LENGTH = 32

/** 时间戳打散步长：与 32 互质，保证各位落在互不相同的位置 */
const STAMP_STEP = 7

/** 单字符随机十六进制位 */
function randomHexDigit(): string {
    return randomInt(16).toString(16)
}

/** 生成带时间戳打散的 UUID 风格 ID */
export function generateNoteId(now: number): string {
    const digits: string[] = []
    for (let index = 0; index < ID_HEX_LENGTH; index += 1) {
        digits.push(randomHexDigit())
    }
    // 起点由时间戳低位决定，写入位置按固定步长推进，避免连续创建的 ID 出现位置规律
    let cursor = now % ID_HEX_LENGTH
    for (const char of now.toString(16)) {
        cursor = (cursor + STAMP_STEP) % ID_HEX_LENGTH
        digits[cursor] = char
    }
    const hex = digits.join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 相对存储根的年月目录，形如 notes/202610 */
export function buildNoteDirectory(now: Date): string {
    const month = String(now.getMonth() + 1).padStart(2, '0')
    return `${NOTE_DIR}/${now.getFullYear()}${month}`
}

/** 空笔记内容：Frontmatter（created / tags / source）+ 一级标题 + 末尾空行作为光标落点，不写 title */
export function buildNoteContent(title: string, now: Date): string {
    return ['---', `created: "${now.toISOString()}"`, 'tags: []', 'source: manual', '---', '', `# ${title}`, ''].join(
        '\n',
    )
}

/** 笔记草稿：落盘所需的全部信息，path 与索引库 files.path 同口径 */
export interface NoteDraft {
    path: string
    directory: string
    fileName: string
    title: string
    content: string
}

/** 生成一份空笔记草稿 */
export function createNoteDraft(now: Date, title: string = DEFAULT_NOTE_TITLE): NoteDraft {
    const fileName = `${generateNoteId(now.getTime())}.md`
    const directory = buildNoteDirectory(now)
    return {
        path: `${directory}/${fileName}`,
        directory,
        fileName,
        title,
        content: buildNoteContent(title, now),
    }
}
