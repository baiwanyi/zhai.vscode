/**
 * 标注读写：加载当前文档的划线与批注，按选区新建、按 id 删除，并把结果同步到装饰层。
 * 复用约定：协议走 bridge 的 request，类型取 @shared/types/editor；装饰应用交给 annotations/annotationDecorations。
 * 关键约束：新建前按「同块 + 同 quote」判断是否已有划线——存在即删除，实现「同色再点即取消」；
 * 改色不能复用这条 toggle：命中即删会把刚划的线抹掉，故单列 applyHighlightColor 走增量更新；
 * 一律以宿主回执后的重新加载为准，不在本地推测列表，避免与另一个窗口的改动打架。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationDraft, AnnotationRecord, EditorBlock, HighlightColor } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'
import type { FrozenRange } from '../selection/formatCommands'
import type { Editor } from '@tiptap/react'
import { applyAnnotationDecorations } from '../annotations/annotationDecorations'
import { selectBlockAnnotations } from '../annotations/selectors'
import { textOffsetAt } from '../selection/wordSelection'

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
 * 由给定范围（缺省为当前选区）生成标注草案：只支持单块内的范围，跨块直接返回 null。
 * range 让调用方显式给出锚点范围；菜单或弹窗夺焦后当前选区可能已塌陷，缺省回落不可靠。
 * startOffset 换算成全文偏移（块起始 + 块内偏移），与宿主快照的块偏移口径一致。
 */
function buildDraft(editor: Editor, blocks: readonly EditorBlock[], range?: FrozenRange): AnnotationDraft | null {
    const { from, to } = range ?? editor.state.selection
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
    const blockNode = editor.state.doc.child(blockIndex)
    const blockText = blockNode.textContent.slice(0, BLOCK_TEXT_LIMIT)
    // 文档位置差要扣掉 inline leaf（硬换行）占的位置，否则含软换行的段落锚点会漂
    const localStart = textOffsetAt(blockNode, Math.max(0, from - blockStart - 1))
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
    /** 首次加载完成：为 false 时标注尚未渲染 */
    isReady: boolean
    /** 当前文档的标注列表：段末图标点击时按 blockIndex 取用 */
    items: AnnotationRecord[]
    /** 新建划线；同一位置已有划线则删除（toggle 语义）。range 缺省取当前选区 */
    addOrToggleHighlight: (color: HighlightColor, range?: FrozenRange) => Promise<void>
    /** 划线改色：同一位置已有划线只更新颜色，没有才新建（不做 toggle） */
    applyHighlightColor: (color: HighlightColor, range?: FrozenRange) => Promise<void>
    /** 为指定范围（缺省当前选区）新建批注；返回是否真的写入（跨块、只读、快照未就绪均为 false） */
    addNote: (note: string, range?: FrozenRange) => Promise<boolean>
    /** 编辑批注正文：返回是否真的写入（空正文、宿主拒绝均为 false，调用方据此决定是否收起编辑态） */
    updateNote: (id: string, note: string) => Promise<boolean>
    /** 删除任意标注（划线或批注）：返回是否真的删除（失败时由调用方提示，列表按重载结果自愈） */
    removeAnnotation: (id: string) => Promise<boolean>
    /** 文档内容变化后重新加载，用于刷新锚点与装饰 */
    refresh: () => Promise<void>
}

export function useAnnotations(
    editor: Editor | null,
    path: string,
    blocks: readonly EditorBlock[],
): UseAnnotationsResult {
    const [isReady, setIsReady] = useState(false)
    const [items, setItems] = useState<AnnotationRecord[]>([])
    const blocksRef = useRef(blocks)
    /** 请求序号：并发 refresh 只认最后一次，避免旧响应把新列表覆盖回去 */
    const seqRef = useRef(0)
    /** 当前文档路径：响应回来时校验归属，切文档后旧文档的列表不得落库 */
    const pathRef = useRef(path)

    useEffect(() => {
        blocksRef.current = blocks
    }, [blocks])

    // 切文档即作废在途请求并清空列表：新文档的标注返回之前，旧列表会被当成当前文档
    // 参与 toggle 命中与装饰绘制——同块同 quote 时会拿上一份文档的 id 去删，跨文档误删
    useEffect(() => {
        pathRef.current = path
        seqRef.current += 1
        setItems([])
        setIsReady(false)
    }, [path])

    const refresh = useCallback(async (): Promise<void> => {
        if (editor === null || path.length === 0) {
            return
        }
        seqRef.current += 1
        const seq = seqRef.current
        const requestedPath = path
        try {
            const result = await request<{ items: AnnotationRecord[] }>('editor/annotations')
            // 后发先至与切文档都要丢弃：只有最新一次请求、且仍属同一文档才允许落库
            if (seq !== seqRef.current || requestedPath !== pathRef.current) {
                return
            }
            setItems(result.items)
            setIsReady(true)
        } catch {
            // 失败不降级 isReady：置回 false 会让下面的补绘永久停摆，已画出的划线再也回不来
        }
    }, [editor, path])

    useEffect(() => {
        void refresh()
    }, [refresh])

    // 文档重建后重绘：快照回灌、回滚与 stale 重载都会 setContent 整篇重建，
    // 装饰随事务 mapping 一起失效，而 items 没变不会触发 refresh——不补这一笔，划线就凭空消失
    useEffect(() => {
        if (editor === null || editor.isDestroyed || !isReady) {
            return
        }
        applyAnnotationDecorations(editor, items)
    }, [blocks, editor, isReady, items])

    const addOrToggleHighlight = useCallback(
        async (color: HighlightColor, range?: FrozenRange): Promise<void> => {
            if (editor === null || path.length === 0 || !editor.isEditable) {
                return
            }
            const draft = buildDraft(editor, blocksRef.current, range)
            if (draft === null) {
                return
            }
            const existing = selectBlockAnnotations(items, draft.blockIndex, 'highlight').find(
                (item) => item.quote === draft.quote,
            )
            try {
                if (existing !== undefined) {
                    await request('editor/annotation/remove', { path, id: existing.id })
                } else {
                    await request('editor/annotation/add', { path, kind: 'highlight', color, note: null, draft })
                }
                await refresh()
            } catch {
                // 失败保持原状：宿主侧错误已由文档同步状态栏统一提示
            }
        },
        [editor, items, path, refresh],
    )

    /**
     * 给同位置的划线改色：已有则只更新颜色，没有才新建。
     * 不复用 addOrToggleHighlight——那条是 toggle，命中会把刚划的线删掉。
     */
    const applyHighlightColor = useCallback(
        async (color: HighlightColor, range?: FrozenRange): Promise<void> => {
            if (editor === null || path.length === 0 || !editor.isEditable) {
                return
            }
            const draft = buildDraft(editor, blocksRef.current, range)
            if (draft === null) {
                return
            }
            const existing = selectBlockAnnotations(items, draft.blockIndex, 'highlight').find(
                (item) => item.quote === draft.quote,
            )
            if (existing !== undefined && existing.color === color) {
                return
            }
            try {
                if (existing === undefined) {
                    await request('editor/annotation/add', { path, kind: 'highlight', color, note: null, draft })
                } else {
                    await request('editor/annotation/update', { path, id: existing.id, color })
                }
                await refresh()
            } catch {
                // 失败保持原状：宿主侧错误已由文档同步状态栏统一提示
            }
        },
        [editor, items, path, refresh],
    )

    const addNote = useCallback(
        async (note: string, range?: FrozenRange): Promise<boolean> => {
            if (editor === null || path.length === 0 || !editor.isEditable || note.trim() === '') {
                return false
            }
            const draft = buildDraft(editor, blocksRef.current, range)
            if (draft === null) {
                // 跨块选区、选区已塌陷或锚点算不出来：不猜范围，由调用方提示并保住用户输入
                return false
            }
            try {
                await request('editor/annotation/add', { path, kind: 'note', color: null, note, draft })
                await refresh()
                return true
            } catch {
                // 同上，失败要把结果交回调用方，不能关掉弹窗当成成功
                return false
            }
        },
        [editor, path, refresh],
    )

    const updateNote = useCallback(
        async (id: string, note: string): Promise<boolean> => {
            // 快照未就绪时 path 为空，宿主必然拒绝，不必多走一次往返
            if (editor === null || path.length === 0 || note.trim() === '') {
                return false
            }
            try {
                await request('editor/annotation/update', { path, id, note })
                await refresh()
                return true
            } catch {
                // 失败要把结果交回调用方：收起编辑态会让用户以为改好了
                return false
            }
        },
        [editor, path, refresh],
    )

    const removeAnnotation = useCallback(
        async (id: string): Promise<boolean> => {
            if (editor === null || path.length === 0) {
                return false
            }
            try {
                await request('editor/annotation/remove', { path, id })
                await refresh()
                return true
            } catch {
                // 同上，删除失败不能让调用方静默当成删掉了
                return false
            }
        },
        [editor, path, refresh],
    )

    return { isReady, items, addOrToggleHighlight, applyHighlightColor, addNote, updateNote, removeAnnotation, refresh }
}
