/**
 * 编辑器文档快照与块级回写：把 Markdown 拆成「frontmatter + 顶层块」，逐块渲染 HTML 供 TipTap 使用。
 * 复用约定：解析与序列化走项目已有的 unified / remark 生态（remark-parse、remark-gfm、remark-rehype、
 * rehype-stringify、rehype-parse、rehype-remark、remark-stringify），与公众号渲染同一条管线；
 * 回写只替换发生变化块的原文区间，未编辑块保留原始 Markdown，避免整篇重排。
 * 关键约束：白名单外的节点（表格、图片、HTML 块、脚注、链接等）一律渲染为源码块并置 editable=false，
 * 界面转只读预览——宁可不给编辑，也不能把不支持的语法回写成别的形态；
 * 依赖体量大（unified 全家桶），首次使用时动态加载，激活期不承担这份开销。
 */
import type { EditorBlock, EditorDocSnapshot } from '@shared/types/editor'
import type { Root as MdastRoot, RootContent } from 'mdast'
import type rehypeParse from 'rehype-parse'
import type rehypeRemark from 'rehype-remark'
import type rehypeStringify from 'rehype-stringify'
import type remarkGfm from 'remark-gfm'
import type remarkParse from 'remark-parse'
import type remarkRehype from 'remark-rehype'
import type remarkStringify from 'remark-stringify'
import type { unified } from 'unified'

/** 当前可安全编辑的节点类型：与 StarterKit 的 schema 一一对应，扩展开启后再逐项放开 */
const EDITABLE_NODE_TYPES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'list',
    'listItem',
    'code',
    'thematicBreak',
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
    // 任务列表暂不支持：未装 taskList 扩展时，`- [ ] x` 会被解析成字面量「[ ] x」，
    // 保存时再被转义回 `- \[ ]`，等于把 GFM 语法改坏。在转换层做完之前一律按只读处理。
    const candidate = node as { type: string; checked?: unknown }
    if (candidate.type === 'listItem' && candidate.checked !== null && candidate.checked !== undefined) {
        return false
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
            ? toHtml
                  .stringify(toHtml.runSync({ type: 'root', children: [node] }))
                  .toString()
                  .trim()
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

/** 把变化块的 HTML 转回 Markdown，生成按偏移倒序排列的替换清单 */
export async function buildBlockEdits(
    blocks: EditorBlock[],
    changes: readonly { index: number; html: string }[],
): Promise<BlockEdit[]> {
    const loaded = await loadDeps()
    const toMarkdown = loaded
        .unified()
        .use(loaded.rehypeParse, { fragment: true })
        .use(loaded.rehypeRemark)
        .use(loaded.remarkStringify, { bullet: '-', emphasis: '*', strong: '*' })
    const edits: BlockEdit[] = []
    for (const change of [...changes].sort((left, right) => right.index - left.index)) {
        const block = blocks[change.index]
        if (block === undefined) {
            continue
        }
        const markdown = toMarkdown.stringify(toMarkdown.runSync(toMarkdown.parse(change.html))).trim()
        edits.push({ start: block.start, end: block.end, text: markdown })
    }
    return edits
}
