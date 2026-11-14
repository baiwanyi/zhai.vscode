/**
 * 编辑器行号栏：按 Markdown 全文的真实行号逐行渲染，数值与文本编辑器一致。
 * 复用约定：行号来自宿主快照（blocks 的 startLine / endLine，已含 frontmatter 占用行），
 * 块内多行与块间空行按所在 DOM 的纵向区间均分定位；字号、字重、颜色取 VSCode 行号变量。
 * 关键约束：只读 DOM、不改文档；测量一律相对 .zhai-editor-page 求差，滚动与页内边距不会让整列偏移；
 * 空文本块不产生 Markdown 行，映射到快照时必须跳过，否则整列行号会整体错位；
 * 快照落后于 DOM（刚敲出的新块）时按上一块末行继续排，等 500ms 防抖回写后自动纠正。
 */
import { useEffect, useRef, useState } from 'react'
import type { EditorBlock } from '@shared/types/editor'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { EDITOR_PAGE_CLASS } from '../domContracts'

/** 一条行号：top / height 为相对 .zhai-editor-page 的像素值 */
interface LineMark {
    line: number
    top: number
    height: number
    isActive: boolean
}

export interface EditorLineNumbersProps {
    editor: Editor | null
    /** 宿主快照块：startLine / endLine 决定行号数值与每块占的逻辑行数 */
    blocks: readonly EditorBlock[]
}

/** 单个块最多渲染的行数：异常数据（行号跨度失真）时兜底，避免把行号栏撑爆 */
const MAX_LINES_PER_BLOCK = 500

/**
 * 光标所在块的快照下标：与 useEditorDocument 的采集口径一致，空文本块不计入。
 * 返回 -1 表示光标落在空块上，此时不高亮任何行号。
 */
function readActiveBlockIndex(editor: Editor): number {
    const { $from } = editor.state.selection
    const top = $from.depth > 0 ? $from.before(1) : 0
    let found = -1
    let counted = 0
    editor.state.doc.forEach((node, offset) => {
        if (node.isTextblock && node.content.size === 0) {
            return
        }
        if (offset === top) {
            found = counted
        }
        counted += 1
    })
    return found
}

/** 测量一次行号：先按 DOM 顺序对齐快照块，再逐块均分行、补齐块间空行 */
function collectMarks(editor: Editor, blocks: readonly EditorBlock[]): LineMark[] {
    const page = editor.view.dom.closest(`.${EDITOR_PAGE_CLASS}`)
    if (!(page instanceof HTMLElement)) {
        return []
    }
    const pageTop = page.getBoundingClientRect().top
    const activeIndex = readActiveBlockIndex(editor)
    // 顶层节点 → 快照下标：空文本块记为 -1，与采集口径一致
    const snapshotIndices: number[] = []
    let snapshotCursor = 0
    editor.state.doc.forEach((node) => {
        if (node.isTextblock && node.content.size === 0) {
            snapshotIndices.push(-1)
            return
        }
        snapshotIndices.push(snapshotCursor)
        snapshotCursor += 1
    })
    const elements = Array.from(editor.view.dom.children)
    const marks: LineMark[] = []
    let previousEndLine: number | null = null
    let previousBottom: number | null = null
    for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index]
        const snapshotIndex = snapshotIndices[index] ?? -1
        if (!(element instanceof HTMLElement) || snapshotIndex < 0) {
            continue
        }
        const block = blocks[snapshotIndex]
        const rect = element.getBoundingClientRect()
        const top = rect.top - pageTop
        const height = rect.height
        // 快照缺失或落后时按上一块末行续排：新敲的段落先给一个临时行号，回写后自动校正
        const startLine: number = block?.startLine ?? (previousEndLine === null ? 1 : previousEndLine + 1)
        const endLine: number = block?.endLine ?? startLine
        const lineCount = Math.max(Math.min(endLine - startLine + 1, MAX_LINES_PER_BLOCK), 1)
        // 块间空行：Markdown 两个块之间必有空行，不补就会跳号，与文本编辑器对不上
        if (previousEndLine !== null && previousBottom !== null && startLine > previousEndLine + 1) {
            const gapLines = startLine - previousEndLine - 1
            const gapHeight = top - previousBottom
            if (gapHeight > 0) {
                for (let offset = 0; offset < gapLines; offset += 1) {
                    marks.push({
                        line: previousEndLine + offset + 1,
                        top: previousBottom + (gapHeight * offset) / gapLines,
                        height: gapHeight / gapLines,
                        isActive: false,
                    })
                }
            }
        }
        for (let offset = 0; offset < lineCount; offset += 1) {
            marks.push({
                line: startLine + offset,
                top: top + (height * offset) / lineCount,
                height: height / lineCount,
                isActive: snapshotIndex === activeIndex && offset === 0,
            })
        }
        previousEndLine = endLine
        previousBottom = top + height
    }
    return marks
}

export function EditorLineNumbers({ editor, blocks }: EditorLineNumbersProps): JSX.Element | null {
    const [marks, setMarks] = useState<LineMark[]>([])
    const frameRef = useRef<number | null>(null)

    useEffect(() => {
        if (editor === null || editor.isDestroyed) {
            return
        }
        // 逐帧合并：键入时每个字符都会触发 update，逐次量矩形会让滚动与输入都发涩
        const schedule = (): void => {
            if (frameRef.current !== null) {
                return
            }
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null
                setMarks(collectMarks(editor, blocks))
            })
        }
        schedule()
        editor.on('update', schedule)
        editor.on('selectionUpdate', schedule)
        const observer = new ResizeObserver(schedule)
        observer.observe(editor.view.dom)
        window.addEventListener('resize', schedule)
        return (): void => {
            editor.off('update', schedule)
            editor.off('selectionUpdate', schedule)
            observer.disconnect()
            window.removeEventListener('resize', schedule)
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current)
                frameRef.current = null
            }
        }
    }, [editor, blocks])

    if (editor === null || marks.length === 0) {
        return null
    }
    return (
        <div className="zhai-line-numbers" aria-hidden="true">
            {marks.map((mark) => (
                <span
                    key={mark.line}
                    className={mark.isActive ? 'zhai-line-number is-active' : 'zhai-line-number'}
                    style={{ top: mark.top, height: mark.height, lineHeight: `${String(mark.height)}px` }}
                >
                    {mark.line}
                </span>
            ))}
        </div>
    )
}
