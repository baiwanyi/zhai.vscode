/**
 * 编辑器文档快照与块级回写：把 Markdown 拆成「frontmatter + 顶层块」，逐块渲染 HTML 供 TipTap 使用。
 * 复用约定：解析与序列化走项目已有的 unified / remark 生态（remark-parse、remark-gfm、remark-rehype、
 * rehype-stringify、rehype-parse、rehype-remark、remark-stringify），与公众号渲染同一条管线；
 * 回写只替换发生变化块的原文区间，未编辑块保留原始 Markdown，避免整篇重排。
 * 关键约束：不再做整篇白名单判定，任何文档都以可编辑状态打开——只读会让链接、划线、
 * 甚至回车都失效，用户只会觉得编辑器坏了；管线渲染不出的节点（原始 HTML、指令、扩展语法）
 * 一律转义成纯文本段落，既不设只读也不显示源码块标识，保证块数与内容始终可对齐；
 * 依赖体量大（unified 全家桶），首次使用时动态加载，激活期不承担这份开销。
 */
import type { EditorBlock, EditorBlockChange, EditorDocSnapshot } from '@shared/types/editor'
import type { Link, Parent, Root as MdastRoot } from 'mdast'
import type rehypeParse from 'rehype-parse'
import type rehypeRemark from 'rehype-remark'
import type rehypeStringify from 'rehype-stringify'
import type remarkGfm from 'remark-gfm'
import type remarkParse from 'remark-parse'
import type remarkRehype from 'remark-rehype'
import type remarkStringify from 'remark-stringify'
import type { unified } from 'unified'

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

/** 源片段不以 `[` 或 `<` 起头，说明这枚链接是 GFM 从裸地址自动识别出来的 */
function isAutolinkLiteral(node: Link, source: string): boolean {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) {
        return false
    }
    const raw = source.slice(start, end)
    return !raw.startsWith('[') && !raw.startsWith('<')
}

/**
 * 裸 URL 的 GFM 自动识别会让「取消链接」失效：取消后回写成裸地址，
 * 下一次快照又被识别成链接，看起来点了取消却没生效。
 * 这里把自动识别出来的 link 降级为纯文本，只保留显式写的 `[文字](地址)` 与 `<地址>`。
 */
function demoteAutolinkLiterals(node: Parent, source: string): void {
    const children = node.children
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (child === undefined) {
            continue
        }
        if (child.type === 'link' && isAutolinkLiteral(child, source)) {
            children[index] = {
                type: 'text',
                value: child.children.map((item) => ('value' in item ? item.value : '')).join(''),
            }
            continue
        }
        if ('children' in child) {
            demoteAutolinkLiterals(child, source)
        }
    }
}

/** HTML 转义：纯文本兜底要把原文原样显示，不能让内容被当作标签解析 */
function escapeHtml(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/**
 * 纯文本兜底：管线渲染不出的节点按原样文字呈现。
 * 关键约束：必须包成一个段落，空串会被 TipTap 直接丢弃——块序列一旦比宿主短，
 * 后续所有块的偏移整体错位，回写就会落到别的段落上；这里宁可显示原文也不放弃这一块。
 */
function toPlainTextHtml(source: string): string {
    return `<p>${escapeHtml(source.trim())}</p>`
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
    for (const node of root.children) {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start === undefined || end === undefined) {
            continue
        }
        // 先把裸地址自动识别出来的链接降级成纯文本：否则「取消链接」写得回去、读回来又是链接
        if ('children' in node) {
            demoteAutolinkLiterals(node, body)
        }
        const raw = body.slice(start, end)
        let html: string
        try {
            html = adaptTableHtml(
                adaptTaskListHtml(
                    toHtml
                        .stringify(toHtml.runSync({ type: 'root', children: [node] }))
                        .toString()
                        .trim(),
                ),
            )
        } catch {
            // 管线不认识这个节点（扩展语法、被 HTML 包裹的块等）：按纯文本处理，
            // 不设只读、不显示源码块标识，编辑后回写成普通段落文字
            html = toPlainTextHtml(raw)
        }
        if (html.length === 0) {
            // 渲染结果为空（原始 HTML 节点、链接定义等会被管线静默丢弃）：
            // 直接透传会让 TipTap 少一个块，后续块的偏移全部错位，必须换成纯文本占位
            html = toPlainTextHtml(raw)
        }
        blocks.push({ html, start: offset + start, end: offset + end })
    }
    // 不再做整篇白名单判定：编辑器始终可编辑，语法能否往返由回写后的自检兜底
    return { path, version, frontmatter, blocks, editable: true }
}

/** 一个待应用的文本替换：偏移基于当前文档，多个块必须从后往前应用 */
export interface BlockEdit {
    start: number
    end: number
    text: string
}

/**
 * 应用替换清单得到新全文：edits 必须已按 start 倒序，这样前面的偏移不会被后续替换影响。
 * 宿主回写直接交给 WorkspaceEdit 按区间替换；这里保留整篇拼装口径，供单测与偏移核对复用。
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
export async function buildEdits(text: string, ranges: readonly EditorBlockChange[]): Promise<BlockEdit[]> {
    const loaded = await loadDeps()
    const toMarkdown = loaded
        .unified()
        .use(loaded.rehypeParse, { fragment: true })
        .use(loaded.rehypeRemark)
        // remark-gfm 必须挂上：删除线（Strike 渲染成 <s>）会转成 mdast 的 delete 节点，
        // 没有 GFM 的 stringify 扩展就会抛 `Cannot handle unknown node 'delete'`，
        // 含删除线的块一旦编辑就整块回写失败
        .use(loaded.remarkGfm)
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
