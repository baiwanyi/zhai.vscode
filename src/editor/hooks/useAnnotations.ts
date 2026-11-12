/**
 * 标注读写：加载当前文档划线、按选区新建或取消，并把结果同步到装饰层。
 * 复用约定：协议走 bridge 的 request，类型取 @shared/types/editor；装饰应用交给 marks/annotationDecorations。
 * 关键约束：新建前按「同块 + 同 quote」判断是否已存在——存在即删除，实现「同色再点即取消」；
 * 一律以宿主回执后的重新加载为准，不在本地推测列表，避免与另一个窗口的改动打架。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationDraft, AnnotationRecord, EditorBlock, HighlightColor } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'
import type { Editor } from '@tiptap/react'
import { applyAnnotationDecorations } from '../marks/annotationDecorations'

/** 前后文各取多少字符：重定位时用于消歧 */
const CONTEXT_CHARS = 32

/** 段落原文快照上限：与库里的 block_text 截断保持一致 */
const BLOCK_TEXT_LIMIT = 1000

/** 稳定短哈希：仅用于块兜底锚点，不要求抗碰撞 */
function hashText(text: string): string {
    let hash = 5381
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
    }
    return (hash >>> 0).toString(16)
}

/**
 * 由当前选区生成标注草案：只支持单块内的选区，跨块直接返回 null（不支持跨段划线）。
 * startOffset 换算成全文偏移（块起始 + 块内偏移），与宿主快照的块偏移口径一致。
 */
function buildDraft(editor: Editor, blocks: readonly EditorBlock[]): AnnotationDraft | null {
    const { from, to } = editor.state.selection
    if (from === to) {
        return null
    }
    const quote = editor.state.doc.textBetween(from, to, ' ').trim()
    if (quote.length === 0) {
        return null
    }
    let blockIndex = -1
    let blockStart = 0
    editor.state.doc.content.forEach((node, offset, index) => {
        if (from >= offset && to <= offset + node.nodeSize) {
            blockIndex = index
            blockStart = offset
        }
    })
    if (blockIndex < 0) {
        return null
    }
    const blockText = editor.state.doc.child(blockIndex).textContent.slice(0, BLOCK_TEXT_LIMIT)
    const localStart = Math.max(0, from - blockStart - 1)
    const block = blocks[blockIndex]
    const globalStart = (block?.start ?? 0) + localStart
    return {
        quote,
        prefix: blockText.slice(Math.max(0, localStart - CONTEXT_CHARS), localStart),
        suffix: blockText.slice(localStart + quote.length, localStart + quote.length + CONTEXT_CHARS),
        startOffset: globalStart,
        endOffset: globalStart + quote.length,
        blockId: '',
        blockIndex,
        blockHash: hashText(blockText),
        blockText,
    }
}

export interface UseAnnotationsResult {
    /** 首次加载完成：为 false 时划线条目尚未渲染 */
    isReady: boolean
    /** 新建划线；同一位置已有划线则删除（toggle 语义） */
    addOrToggleHighlight: (color: HighlightColor) => Promise<void>
    removeHighlight: (id: string) => Promise<void>
    /** 文档内容变化后重新加载，用于刷新锚点与装饰 */
    refresh: () => Promise<void>
}

export function useAnnotations(
    editor: Editor | null,
    path: string,
    blocks: readonly EditorBlock[],
): UseAnnotationsResult {
    const [isReady, setIsReady] = useState(false)
    const itemsRef = useRef<AnnotationRecord[]>([])
    const blocksRef = useRef(blocks)

    useEffect(() => {
        blocksRef.current = blocks
    }, [blocks])

    const refresh = useCallback(async (): Promise<void> => {
        if (editor === null || path.length === 0) {
            return
        }
        try {
            const result = await request<{ items: AnnotationRecord[] }>('editor/annotations')
            itemsRef.current = result.items
            applyAnnotationDecorations(editor, result.items)
            setIsReady(true)
        } catch {
            setIsReady(false)
        }
    }, [editor, path])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const addOrToggleHighlight = useCallback(
        async (color: HighlightColor): Promise<void> => {
            if (editor === null || path.length === 0 || !editor.isEditable) {
                return
            }
            const draft = buildDraft(editor, blocksRef.current)
            if (draft === null) {
                return
            }
            const existing = itemsRef.current.find(
                (item) =>
                    item.kind === 'highlight' &&
                    item.blockIndex === draft.blockIndex &&
                    item.quote === draft.quote &&
                    !item.orphaned,
            )
            try {
                if (existing !== undefined) {
                    await request('editor/annotation/remove', { path, id: existing.id })
                } else {
                    await request('editor/annotation/add', { path, color, draft })
                }
                await refresh()
            } catch {
                // 失败保持原状：宿主侧错误已由文档同步状态栏统一提示
            }
        },
        [editor, path, refresh],
    )

    const removeHighlight = useCallback(
        async (id: string): Promise<void> => {
            try {
                await request('editor/annotation/remove', { path, id })
                await refresh()
            } catch {
                // 同上，不打断编辑
            }
        },
        [path, refresh],
    )

    return { isReady, addOrToggleHighlight, removeHighlight, refresh }
}
