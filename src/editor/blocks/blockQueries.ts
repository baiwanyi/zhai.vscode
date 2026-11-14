/**
 * 块位置查询：把文档偏移换算成顶层块起点、快照序号与选区块范围，全部只读不写。
 * 复用约定：只依赖 Editor 与 ProseMirror 文档，不碰 DOM、不派发事务；
 * 快照口径（跳过空文本块）由 forEachSnapshotBlock 统一，调用方不要再手写遍历。
 * 关键约束：两套块序号不可混用——快照口径供宿主换算 Markdown 行，原始口径（含空块）供批注锚点；
 * 位置一律先经 clampDocPos 夹进有效范围，负数与非有限数不会漏到 doc.resolve 上。
 */
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 把位置夹进 [0, doc.content.size]：负数归 0，非有限数也归 0（落到「取不到块」而不是取到最后一块） */
function clampDocPos(doc: ProseMirrorNode, pos: number): number {
    if (!Number.isFinite(pos)) {
        return 0
    }
    return Math.min(Math.max(pos, 0), doc.content.size)
}

/**
 * 遍历顶层块并给出快照序号：空文本块不进快照（与 useEditorDocument 的 collectBlocks 同口径），
 * 序号只在非空块上累加。offset 是相对文档内容的块起点，可直接与文档偏移比较。
 */
function forEachSnapshotBlock(
    doc: ProseMirrorNode,
    visit: (node: ProseMirrorNode, offset: number, index: number) => void,
): void {
    let index = 0
    doc.content.forEach((node, offset) => {
        if (node.isTextblock && node.content.size === 0) {
            return
        }
        visit(node, offset, index)
        index += 1
    })
}

/**
 * 指定位置（缺省为选区起点）所在的顶层块起始位置：块把手、块菜单与选区工具条共用同一口径。
 * 文档切换瞬间旧偏移可能越界，resolve 会抛 RangeError，先夹到有效范围。
 */
export function readTopBlockPos(editor: Editor, pos?: number): number | null {
    if (editor.isDestroyed) {
        return null
    }
    const { doc, selection } = editor.state
    const raw = pos ?? selection.from
    if (!Number.isFinite(raw)) {
        return null
    }
    const resolved = doc.resolve(clampDocPos(doc, raw))
    const top = resolved.depth > 0 ? resolved.before(1) : 0
    return doc.nodeAt(top) === null ? null : top
}

/** 选区覆盖的快照块范围：起点块与终点块，供宿主把「选中行」换算成 Markdown 行范围 */
export interface SelectionBlockRange {
    startIndex: number
    endIndex: number
}

/**
 * 块在快照里的序号：宿主据此把块换算成 Markdown 行号，比按文本搜索精确——
 * 同一句在文中出现多次时不会定位到第一次。
 * 关键约束：必须与 useEditorDocument 的 collectBlocks 同口径，跳过空文本块——
 * 空段落不产生 Markdown 块，若把它算进序号，宿主会取到相邻块，引用的行范围与字数都会错。
 * 只认块起点（offset === pos），传块内偏移返回 -1，由宿主退回文本定位。
 */
export function readBlockIndex(editor: Editor, pos: number | null): number {
    if (editor.isDestroyed || pos === null || pos < 0 || pos > editor.state.doc.content.size) {
        return -1
    }
    let index = -1
    forEachSnapshotBlock(editor.state.doc, (_node, offset, snapshotIndex) => {
        if (offset === pos) {
            index = snapshotIndex
        }
    })
    return index
}

/**
 * 位置之前的最后一个非空快照块序号：按「块起点 < 位置」推进，不做 doc.resolve。
 * 关键约束：不能用 resolve + before(1) 求终点块——终点是「最后一个选中字符之后」，
 * 落在块边界或空段落上时 resolve 只给到浅层位置，before(1) 会退化成文档首块，
 * 整段范围随之塌成只有第一行；按块起点推进则天然把终点归到它之前的那一块。
 */
function readBlockIndexBefore(editor: Editor, pos: number): number {
    const { doc } = editor.state
    const limit = clampDocPos(doc, pos)
    let index = -1
    forEachSnapshotBlock(doc, (_node, offset, snapshotIndex) => {
        if (offset < limit) {
            index = snapshotIndex
        }
    })
    return index
}

/**
 * 选区覆盖的快照块范围：起点块与终点块各取一次序号，供宿主按「整行」引用。
 * 关键约束：选区只覆盖某行的一部分时仍按所在块取范围，宿主据此引用整行——
 * 行号换算在宿主侧完成，webview 只交出块序号，不自己算行；
 * 终点落在空段落（选中范围拖到文末空行）时回溯到最近的非空块，不能退回首块；
 * 终点序号小于起点（选区退化）时按起点块处理，避免宿主取到空区间。
 */
export function readSelectionBlockRange(editor: Editor, from: number, to: number): SelectionBlockRange | null {
    if (editor.isDestroyed) {
        return null
    }
    // 起点取「包含该位置的块」：+1 让落在块首或文档开头的起点归到本块，而不是上一块
    const startIndex = readBlockIndexBefore(editor, from + 1)
    if (startIndex < 0) {
        return null
    }
    const endIndex = readBlockIndexBefore(editor, to)
    return { startIndex, endIndex: endIndex < startIndex ? startIndex : endIndex }
}

/** 读取顶层块：pos 越界时返回 null，nodeAt 在越界位置会抛 RangeError */
export function readBlockNode(editor: Editor, pos: number): ProseMirrorNode | null {
    if (editor.isDestroyed || pos < 0 || pos >= editor.state.doc.content.size) {
        return null
    }
    return editor.state.doc.nodeAt(pos)
}

/**
 * pos 所在的顶层块序号（按 doc 原始顺序，含空文本块）。
 * 与 readBlockIndex 的「跳过空块」口径不同：批注锚点用的是原始序号，两者不可混用。
 * pos 落空（越界或文末）返回 -1，调用方按「定位不到」处理。
 */
export function readTopBlockIndexAt(doc: ProseMirrorNode, pos: number): number {
    if (pos < 0 || pos >= doc.content.size) {
        return -1
    }
    let found = -1
    doc.content.forEach((node, offset, index) => {
        if (pos >= offset && pos < offset + node.nodeSize) {
            found = index
        }
    })
    return found
}

/** 块纯文本：复制文本与 AI 询问都取这一份口径 */
export function readBlockText(node: ProseMirrorNode): string {
    return node.textContent
}
