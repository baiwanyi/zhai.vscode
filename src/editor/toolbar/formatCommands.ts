/**
 * 选区行内格式的命令层：激活态读取、开关命令与链接地址校验。
 * 复用约定：只读写 ProseMirror 状态与 chain 命令，不渲染、不提示；范围由调用方冻结后传入，
 * 执行前用 setTextSelection 恢复，菜单或输入框夺焦也不会把格式落到光标处。
 * 关键约束：链接只放行 http(s)、mailto 与站内相对地址，其余协议一律拒绝——
 * href 会被 webview 直接点开，不能让 javascript: 之类混进正文；
 * 不提供下划线：GFM 没有对应语法，写进正文会变成内联 HTML，回写自检会把整篇文档转为只读。
 */
import { getMarkRange } from '@tiptap/core'
import { Bold, Italic, Link2, Strikethrough } from 'lucide-react'
import type { ChainedCommands, Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'

/** 工具条上的行内格式：链接走独立输入流程，其余是即时开关 */
export type InlineFormatId = 'bold' | 'italic' | 'strike' | 'link'

/** 可切换的标记：不含链接 */
export type ToggleFormatId = Exclude<InlineFormatId, 'link'>

/** 一条格式按钮配置：图标存组件引用，渲染层只负责映射 */
export interface InlineFormat {
    id: InlineFormatId
    label: string
    icon: LucideIcon
}

/** 按钮清单：顺序即工具条展示顺序 */
export const INLINE_FORMATS: readonly InlineFormat[] = [
    { id: 'bold', label: '加粗', icon: Bold },
    { id: 'italic', label: '斜体', icon: Italic },
    { id: 'strike', label: '删除线', icon: Strikethrough },
    { id: 'link', label: '链接', icon: Link2 },
]

/** 冻结的选区范围：菜单、输入框夺焦后靠它恢复 */
export interface FrozenRange {
    from: number
    to: number
}

/** 切换命令表：与 ToggleFormatId 一一对应，新增标记必须同步补一项 */
const TOGGLE_COMMANDS: Readonly<Record<ToggleFormatId, (chain: ChainedCommands) => ChainedCommands>> = {
    bold: (chain) => chain.toggleBold(),
    italic: (chain) => chain.toggleItalic(),
    strike: (chain) => chain.toggleStrike(),
}

/** 只放行这三类协议：javascript:、data: 等一律视为非法 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

/** 站内相对地址：不做协议补全，原样保留 */
const RELATIVE_HREF = /^(?:\.{0,2}\/|#|\/)/u

/** 是否已带协议：用于区分「example.com」与「javascript:alert(1)」 */
const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/iu

/** 冻结当前选区：空选区返回 null，调用方据此禁用需要范围的命令 */
export function readFrozenRange(editor: Editor): FrozenRange | null {
    const { from, to } = editor.state.selection
    return from === to ? null : { from, to }
}

/** 读取选区已激活的格式：工具条据此点亮按下态 */
export function readActiveFormats(editor: Editor): readonly InlineFormatId[] {
    return INLINE_FORMATS.filter((format) => editor.isActive(format.id)).map((format) => format.id)
}

/**
 * 把冻结范围夹进当前文档：浮层存活期间文档可能被快照重建过，
 * 旧偏移再传给 setTextSelection 会抛 RangeError，整条链会当场中断。
 */
function clampRange(editor: Editor, range: FrozenRange): FrozenRange {
    const max = editor.state.doc.content.size
    const from = Math.min(Math.max(range.from, 0), max)
    const to = Math.min(Math.max(range.to, from), max)
    return { from, to }
}

/** 恢复选区后执行一次链式命令：focus 必须在前，否则菜单关闭后的焦点仍在菜单上 */
function runAtRange(editor: Editor, range: FrozenRange, run: (chain: ChainedCommands) => ChainedCommands): void {
    if (editor.isDestroyed || !editor.isEditable) {
        return
    }
    run(editor.chain().focus().setTextSelection(clampRange(editor, range))).run()
}

/** 切换行内标记（加粗 / 斜体 / 删除线 / 行内代码） */
export function toggleInlineFormat(editor: Editor, range: FrozenRange, id: ToggleFormatId): void {
    runAtRange(editor, range, TOGGLE_COMMANDS[id])
}

/**
 * 读链接地址：优先按给定范围取，缺省才看当前选区。
 * 菜单冻结的 range 才是锚点来源——面板夺焦后当前选区可能已塌陷或停在链接右侧，
 * 只看光标位置会读不到 href，「移除链接」就会被误置灰。
 */
export function readSelectionLink(editor: Editor, range?: FrozenRange): string {
    const linkType = editor.schema.marks.link
    if (linkType === undefined) {
        return ''
    }
    const { doc, selection } = editor.state
    const from = range?.from ?? selection.from
    const to = range?.to ?? selection.to
    // 范围起点与末字符各试一次：起点可能落在 mark 边界外
    for (const pos of [from, Math.max(from, to - 1)]) {
        const resolved = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size))
        const mark = linkType.isInSet(resolved.marks())
        if (mark === undefined) {
            continue
        }
        const attributes: Record<string, unknown> = mark.attrs
        const href = attributes.href
        if (typeof href === 'string') {
            return href
        }
    }
    return ''
}

/**
 * 规范化链接地址：非法协议返回 null，未写协议的域名补 https。
 * 判空与协议白名单是唯一的放行条件，调用方拿到 null 必须拒绝写入。
 */
export function normalizeLinkHref(input: string): string | null {
    const value = input.trim()
    if (value.length === 0) {
        return null
    }
    if (RELATIVE_HREF.test(value)) {
        return value
    }
    const candidate = HAS_PROTOCOL.test(value) ? value : `https://${value}`
    try {
        const url = new URL(candidate)
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null
    } catch {
        // URL 解析失败（含裸主机名缺协议）一律视为非法，不猜
        return null
    }
}

/**
 * 编辑态回填：剥掉 https:// 前缀交给输入框左侧的固定前缀显示，与 normalizeLinkHref 互为正反。
 * 只去 https——http、mailto 这类得原样留着，否则用户看不到自己写的是什么协议；
 * 根路径的尾部斜杠一并去掉（`a.com/` → `a.com`），带路径的斜杠有语义，不动。
 */
export function toEditableHref(href: string): string {
    return href.replace(/^https:\/\//iu, '').replace(/^([^/]+)\/$/u, '$1')
}

/**
 * 给选区套上链接：地址须已通过 normalizeLinkHref 校验；返回是否真的写入了文档。
 * 与摘链一样走纯事务，不 focus 也不改选区——面板按钮点击时抢焦点会连带关掉浮层、
 * 把选区从 range 上挪走，后续 refresh 就再也对不上这段文字。
 * 先删同范围旧链接再添加：addMark 是叠加语义，直接加会留下两条 link mark。
 * 返回 false 的三种情况（只读 / 无 link mark / 范围为空且无变化）都要让 UI 说清楚，
 * 否则用户只会看到「点了没反应」。
 */
export function applySelectionLink(editor: Editor, range: FrozenRange, href: string): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    const linkType = editor.schema.marks.link
    if (linkType === undefined) {
        return false
    }
    const { tr } = editor.state
    const { from, to } = clampRange(editor, range)
    if (from >= to) {
        return false
    }
    tr.removeMark(from, to, linkType)
    tr.addMark(from, to, linkType.create({ href }))
    // 不判 docChanged：重复应用同一地址时终态与原文档一致，但 mark 已经就位，不能算失败
    editor.view.dispatch(tr)
    return true
}

/**
 * 摘掉选区上的链接：直接用事务删 mark，不走 focus + chain。
 * 这条命令只改 mark 不改内容与选区，不需要把焦点抢回正文；
 * 空范围（选区内本来就没有链接）不派发事务，避免制造一次无意义的回写。
 */
export function removeSelectionLink(editor: Editor, range: FrozenRange): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    const linkType = editor.schema.marks.link
    if (linkType === undefined) {
        return false
    }
    const { doc, tr } = editor.state
    const { from, to } = clampRange(editor, range)
    // 传入范围可能只覆盖链接的一部分：按 mark 的实际两端再扩一次，
    // 否则会留下半截链接，回写后 Markdown 里还带着 `[文字](url)`
    let removeFrom = from
    let removeTo = to
    for (const pos of [from, to - 1]) {
        const resolved = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size))
        if (linkType.isInSet(resolved.marks()) === undefined) {
            continue
        }
        const full = getMarkRange(resolved, linkType)
        if (full !== undefined) {
            removeFrom = Math.min(removeFrom, full.from)
            removeTo = Math.max(removeTo, full.to)
        }
    }
    tr.removeMark(removeFrom, removeTo, linkType)
    if (!tr.docChanged) {
        return false
    }
    editor.view.dispatch(tr)
    return true
}

/** 清除选区内联格式，并把标题、列表回落为正文 */
export function clearSelectionFormatting(editor: Editor, range: FrozenRange): void {
    runAtRange(editor, range, (chain) => chain.unsetAllMarks().clearNodes())
}
