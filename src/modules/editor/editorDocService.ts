/**
 * 编辑器文档快照与块级回写：把 Markdown 拆成「frontmatter + 顶层块」，逐块渲染 HTML 供 TipTap 使用。
 * 复用约定：解析与序列化走项目已有的 unified / remark 生态（remark-parse、remark-gfm、remark-rehype、
 * rehype-stringify、rehype-parse、rehype-remark、remark-stringify），与公众号渲染同一条管线；
 * 回写只替换发生变化块的原文区间，未编辑块保留原始 Markdown，避免整篇重排。
 * 关键约束：白名单外的节点（表格、图片、HTML 块、脚注、链接等）一律渲染为源码块并置 editable=false，
 * 界面转只读预览——宁可不给编辑，也不能把不支持的语法回写成别的形态；
 * 依赖体量大（unified 全家桶），首次使用时动态加载，激活期不承担这份开销。
 */
import type { EditorBlock, EditorBlockChange, EditorDocSnapshot } from '@shared/types/editor'
import type { Root as MdastRoot, RootContent } from 'mdast'
import type rehypeParse from 'rehype-parse'
import type rehypeRemark from 'rehype-remark'
import type rehypeStringify from 'rehype-stringify'
import type remarkGfm from 'remark-gfm'
import type remarkParse from 'remark-parse'
import type remarkRehype from 'remark-rehype'
import type remarkStringify from 'remark-stringify'
import type { unified } from 'unified'

/**
 * 当前可安全编辑的节点类型：与 StarterKit 的 schema 一一对应，扩展开启后再逐项放开。
 * link 已放开：StarterKit 自带 Link，编辑态可正常选中改动，回写也会还原成 `[文本](地址)`；
 * 把它排除在外会让任何带链接的文档整篇转只读，实际影响面远大于收益。
 */
const EDITABLE_NODE_TYPES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'list',
    'listItem',
    'code',
    'thematicBreak',
    'table',
    'tableRow',
    'tableCell',
    'image',
    'link',
    'text',
    'emphasis',
    'strong',
    'delete',
    'inlineCode',
    'break',
])

/** Frontmatter 块：整段原样保留，不参与块编号与回写 */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u

/** 延迟加载的解析依赖：类型取自各包导出，避免手写签名 */
interface EditorDocDeps {
    unified: typeof unified
    remarkParse: typeof remarkParse
    remarkGfm: typeof remarkGfm
    remarkRehype: typeof remarkRehype
    rehypeStringify: typeof rehypeStringify
    rehypeParse: typeof rehypeParse
    rehypeRemark: typeof rehypeRemark
    remarkStringify: typeof remarkStringify
}

let deps: Promise<EditorDocDeps> | null = null

/** 加载解析依赖：只在首次打开富文本时发生，失败不缓存，便于下次重试 */
async function loadDeps(): Promise<EditorDocDeps> {
    if (deps === null) {
        deps = (async (): Promise<EditorDocDeps> => {
            const [
                unifiedMod,
                remarkParseMod,
                remarkGfmMod,
                remarkRehypeMod,
                rehypeStringifyMod,
                rehypeParseMod,
                rehypeRemarkMod,
                remarkStringifyMod,
            ] = await Promise.all([
                import('unified'),
                import('remark-parse'),
                import('remark-gfm'),
                import('remark-rehype'),
                import('rehype-stringify'),
                import('rehype-parse'),
                import('rehype-remark'),
                import('remark-stringify'),
            ])
            return {
                unified: unifiedMod.unified,
                remarkParse: remarkParseMod.default,
                remarkGfm: remarkGfmMod.default,
                remarkRehype: remarkRehypeMod.default,
                rehypeStringify: rehypeStringifyMod.default,
                rehypeParse: rehypeParseMod.default,
                rehypeRemark: rehypeRemarkMod.default,
                remarkStringify: remarkStringifyMod.default,
            }
        })()
        deps.catch(() => {
            deps = null
        })
    }
    return deps
}

/** 拆分 Frontmatter 与正文：正文偏移在返回值中已加上前缀长度，与全文一致 */
export function splitFrontmatter(text: string): { frontmatter: string; body: string; offset: number } {
    const match = FRONTMATTER_PATTERN.exec(text)
    if (match === null) {
        return { frontmatter: '', body: text, offset: 0 }
    }
    const frontmatter = match[0]
    return { frontmatter, body: text.slice(frontmatter.length), offset: frontmatter.length }
}

/** 递归判断节点是否全部在白名单内：任一子节点越界即视为不可编辑 */
function isSupported(node: RootContent | { type: string; children?: unknown[] }): boolean {
    if (!EDITABLE_NODE_TYPES.has(node.type)) {
        return false
    }
    // 任务列表：纯文本项已支持（见 adaptTaskListHtml），但任务项内再嵌列表暂不支持——
    // 半支持会把它改写成普通列表，等于悄悄丢掉勾选状态，所以整篇转只读更安全。
    const candidate = node as {
        type: string
        checked?: unknown
        align?: (string | null)[]
        children?: { type: string }[]
    }
    if (candidate.type === 'listItem' && candidate.checked !== null && candidate.checked !== undefined) {
        const children = candidate.children ?? []
        if (children.some((child) => child.type === 'list')) {
            return false
        }
    }
    // 表格：Tiptap 的 TableCell 不认对齐属性，放开编辑会把 `:---:` 之类的标记丢掉，
    // 等于改坏原文格式。带对齐的表格仍按只读预览处理。
    if (candidate.type === 'table') {
        const align = candidate.align
        if (Array.isArray(align) && align.some((item) => item !== null && item !== undefined)) {
            return false
        }
    }
    const children = 'children' in node ? node.children : undefined
    if (!Array.isArray(children)) {
        return true
    }
    return children.every((child) =>
        typeof child === 'object' && child !== null && 'type' in child
            ? isSupported(child as { type: string; children?: unknown[] })
            : false,
    )
}

/** HTML 转义：源码块要原样展示，不能让内容被当作标签解析 */
function escapeHtml(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/**
 * 任务列表的 md → html 适配：remark-gfm 输出 `<ul class="contains-task-list">` 与裸 `<input>`，
 * 而 Tiptap 的 TaskList / TaskItem 只认 `data-type` 与 `data-checked`，且要求项内容是块级元素，
 * 否则解析时会退化成普通列表、勾选状态丢失。
 * 关键约束：这里依赖 remark-rehype 的固定输出结构，改动管线时必须同步改本函数（有单测守着）。
 */
function adaptTaskListHtml(html: string): string {
    if (!html.includes('contains-task-list')) {
        return html
    }
    return html.replace(/<ul class="contains-task-list">([\s\S]*?)<\/ul>/gu, (_whole: string, inner: string) => {
        const items = inner.replace(
            /<li class="task-list-item"><input type="checkbox"( checked)? disabled>([\s\S]*?)<\/li>/gu,
            (_item: string, checked: string | undefined, text: string) =>
                `<li data-type="taskItem" data-checked="${checked === undefined ? 'false' : 'true'}"><p>${text.trim()}</p></li>`,
        )
        return `<ul data-type="taskList">${items}</ul>`
    })
}

/** Tiptap 输出的任务项：`<li data-type="taskItem" data-checked="true"><label>…</label><div><p>文本</p></div></li>` */
const TASK_ITEM_PATTERN = /<li[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/gu

/** 去掉 Tiptap 任务项的包装层，只留正文：label 里的 checkbox 与 div/p 包裹都不是内容 */
function stripTaskItemWrappers(inner: string): string {
    return inner
        .replace(/<label[\s\S]*?<\/label>/gu, '')
        .replace(/<input[^>]*>/gu, '')
        .replace(/<\/?(?:div|p)[^>]*>/gu, '')
        .trim()
}

/**
 * 表格的 md → html 适配：remark-rehype 输出的单元格是裸文本，
 * 而 Tiptap 的 TableCell / TableHeader 要求内容是块级元素，否则整张表解析不出结构。
 */
function adaptTableHtml(html: string): string {
    if (!html.includes('<table')) {
        return html
    }
    // 标签名后必须紧跟 > 或空白：否则 `<thead>` 会被当成 `<th>` + 属性 "ead" 吞掉
    return html.replace(
        /<(th|td)(\s[^>]*)?>([\s\S]*?)<\/\1>/gu,
        (whole: string, tag: string, attrs: string | undefined, inner: string) => {
            const trimmed = inner.trim()
            if (trimmed.length === 0 || trimmed.startsWith('<p')) {
                return whole
            }
            return `<${tag}${attrs ?? ''}><p>${trimmed}</p></${tag}>`
        },
    )
}

/** 表格行与单元格：Tiptap 输出结构固定，这里按标签切分即可，不需要整棵 HTML 树 */
const TABLE_ROW_PATTERN = /<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gu
const TABLE_CELL_PATTERN = /<(?:th|td)(?:\s[^>]*)?>([\s\S]*?)<\/(?:th|td)>/gu

/** 合并单元格在 GFM 里无法表达，遇到即放弃改写（保留原文，不让表格结构被压坏） */
const MERGED_CELL_PATTERN = /<(?:td|th)\s[^>]*(?:colspan|rowspan)="[2-9]/u

/**
 * 读取文档快照：frontmatter 原样透传，正文按顶层节点切成块。
 * @param text TextDocument 全文，用于取原文偏移；调用方需保证与 document.version 同源
 */
export async function readEditorSnapshot(text: string, version: number, path: string): Promise<EditorDocSnapshot> {
    const loaded = await loadDeps()
    const { frontmatter, body, offset } = splitFrontmatter(text)
    const parser = loaded.unified().use(loaded.remarkParse).use(loaded.remarkGfm)
    const root: MdastRoot = parser.parse(body)
    const toHtml = loaded.unified().use(loaded.remarkRehype).use(loaded.rehypeStringify)
    const blocks: EditorBlock[] = []
    let isEditable = true
    for (const node of root.children) {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start === undefined || end === undefined) {
            continue
        }
        const isNodeSupported = isSupported(node)
        if (!isNodeSupported) {
            isEditable = false
        }
        const html = isNodeSupported
            ? adaptTableHtml(
                  adaptTaskListHtml(
                      toHtml
                          .stringify(toHtml.runSync({ type: 'root', children: [node] }))
                          .toString()
                          .trim(),
                  ),
              )
            : `<pre class="zhai-source-block">${escapeHtml(body.slice(start, end))}</pre>`
        blocks.push({ html, start: offset + start, end: offset + end })
    }
    return { path, version, frontmatter, blocks, editable: isEditable }
}

/** 一个待应用的文本替换：偏移基于当前文档，多个块必须从后往前应用 */
export interface BlockEdit {
    start: number
    end: number
    text: string
}

/**
 * 应用替换清单得到新全文：edits 必须已按 start 倒序，这样前面的偏移不会被后续替换影响。
 * 用途是写入前的自检——先把结果拼出来重新解析，确认没有引入不支持的语法，再真正落盘。
 */
export function applyBlockEdits(text: string, edits: readonly BlockEdit[]): string {
    let next = text
    for (const edit of edits) {
        next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
    }
    return next
}

/**
 * 把区间变更里的 HTML 转回 Markdown，生成按偏移倒序排列的替换清单。
 * 区间由 Webview 用快照偏移算出，宿主只做范围校验与内容转换——块下标会随插入 / 删除整体位移，偏移不会。
 * 越界、倒序或相互重叠的区间一律丢弃：宁可少写一次，也不能把两段替换套在同一片原文上。
 */
export async function buildEdits(
    text: string,
    ranges: readonly EditorBlockChange[],
): Promise<BlockEdit[]> {
    const loaded = await loadDeps()
    const toMarkdown = loaded
        .unified()
        .use(loaded.rehypeParse, { fragment: true })
        .use(loaded.rehypeRemark)
        .use(loaded.remarkStringify, { bullet: '-', emphasis: '*', strong: '*' })
    /**
     * 任务列表的 html → md：不能走通用管线——rehype-remark 会把 checkbox 转成文本「[x]」，
     * 再被 stringify 转义成 `\[x]`，GFM 语法当场失效。改为逐项读取 data-checked 自行拼行。
     */
    const toTaskMarkdown = (html: string): string => {
        const lines: string[] = []
        for (const match of html.matchAll(TASK_ITEM_PATTERN)) {
            const isChecked = match[1] === 'true'
            const inner = stripTaskItemWrappers(match[2] ?? '')
            const text =
                inner.length === 0
                    ? ''
                    : toMarkdown
                          .stringify(toMarkdown.runSync(toMarkdown.parse(inner)))
                          .trim()
                          .replace(/\n+/gu, ' ')
            lines.push(`- [${isChecked ? 'x' : ' '}] ${text}`.trimEnd())
        }
        return lines.join('\n')
    }
    /**
     * 表格的 html → md：通用管线不认识 table 节点（rehype-remark 直接抛 unknown node），
     * 必须自己按行列拼 GFM 表格；合并单元格无法表达，返回空串表示放弃改写。
     */
    const toTableMarkdown = (html: string): string => {
        if (MERGED_CELL_PATTERN.test(html)) {
            return ''
        }
        const rows: string[][] = []
        for (const rowMatch of html.matchAll(TABLE_ROW_PATTERN)) {
            const cells: string[] = []
            for (const cellMatch of (rowMatch[1] ?? '').matchAll(TABLE_CELL_PATTERN)) {
                const inner = (cellMatch[1] ?? '').replace(/<\/?p[^>]*>/gu, '').trim()
                const text =
                    inner.length === 0
                        ? ''
                        : toMarkdown
                              .stringify(toMarkdown.runSync(toMarkdown.parse(inner)))
                              .trim()
                              .replace(/\n+/gu, ' ')
                cells.push(text.replace(/\|/gu, '\\|'))
            }
            if (cells.length > 0) {
                rows.push(cells)
            }
        }
        if (rows.length === 0) {
            return ''
        }
        const header = rows[0] ?? []
        const divider = header.map(() => '---')
        return [header, divider, ...rows.slice(1)].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
    }
    /** 单块 HTML → Markdown：表格与任务列表各有专用管线，其余走通用 rehype-remark */
    const toBlockMarkdown = (html: string): string => {
        if (html.includes('<table')) {
            return toTableMarkdown(html)
        }
        if (html.includes('data-type="taskList"')) {
            return toTaskMarkdown(html)
        }
        return toMarkdown.stringify(toMarkdown.runSync(toMarkdown.parse(html))).trim()
    }
    const edits: BlockEdit[] = []
    for (const range of ranges) {
        if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
            continue
        }
        if (range.start < 0 || range.end < range.start || range.end > text.length) {
            continue
        }
        if (range.htmls.length === 0) {
            // 前端明确要求删除该区间：空区间没有可删的内容
            if (range.start !== range.end) {
                edits.push({ start: range.start, end: range.end, text: '' })
            }
            continue
        }
        const parts = range.htmls.map(toBlockMarkdown).filter((part) => part.length > 0)
        if (parts.length === 0) {
            // 转换放弃（如合并单元格表格）或内容为空：保留原文，宁可丢这次改动也不压坏结构
            continue
        }
        const markdown = parts.join('\n\n')
        // 块与块之间靠空行分隔：插入点两侧缺少空行时必须补上，否则新块会和相邻段落粘成一段
        const before = text.slice(0, range.start)
        const after = text.slice(range.end)
        const leading = range.start > 0 && !before.endsWith('\n\n') ? '\n\n' : ''
        const trailing = range.end < text.length && !after.startsWith('\n\n') ? '\n\n' : ''
        edits.push({ start: range.start, end: range.end, text: `${leading}${markdown}${trailing}` })
    }
    // 从后往前应用：前面的偏移才不会被后面的替换推走
    edits.sort((left, right) => right.start - left.start)
    // 重叠区间只能留一条：从后往前扫，遇到与前一条相交的整条丢弃
    const ordered: BlockEdit[] = []
    let cursor = Number.POSITIVE_INFINITY
    for (const edit of edits) {
        if (edit.end > cursor) {
            continue
        }
        cursor = edit.start
        ordered.push(edit)
    }
    return ordered
}
