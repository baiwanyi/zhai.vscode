/**
 * 编辑器 webview 主屏：承载 TipTap 编辑区，正文与宿主 TextDocument 双向同步，并驱动划线与批注弹层。
 * 复用约定：内容同步在 useEditorDocument，标注读写在 useAnnotations，浮层组件各自独立；
 * 段末批注图标的点击通过容器事件委托捕获（widget 是原生 DOM，不参与 React 树）。
 * 关键约束：本组件不直接发协议请求，也不决定可编辑性——只读判定来自宿主快照；
 * 状态栏必须如实展示同步状态，出现只读或同步失败时不能让用户以为内容已保存。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import type { AnnotationRecord } from '@shared/types/editor'
import { useAnnotations } from './hooks/useAnnotations'
import { useDocumentQuery } from './hooks/useDocumentQuery'
import { useEditorDocument } from './hooks/useEditorDocument'
import { AnnotationDialog } from './layout/AnnotationDialog'
import { AnnotationPopover } from './layout/AnnotationPopover'
import { QueryDialog } from './layout/QueryDialog'
import { SelectionToolbar } from './layout/SelectionToolbar'
import { AnnotationExtension } from './marks/annotationExtension'
import type { JSX, MouseEvent } from 'react'

/** 段末图标与气泡之间的间距 */
const POPOVER_OFFSET = 4

interface NotePopoverState {
    left: number
    top: number
    blockIndex: number
}

export function EditorScreen(): JSX.Element {
    const editor = useEditor({
        extensions: [StarterKit, AnnotationExtension],
        content: '<p></p>',
        editorProps: {
            attributes: {
                class: 'min-h-[60vh] text-base leading-8 outline-none',
            },
        },
    })
    const { status, isEditable, path, blocks } = useEditorDocument(editor)
    const { items, addOrToggleHighlight, addNote, removeAnnotation } = useAnnotations(editor, path, blocks)
    const [annotationQuote, setAnnotationQuote] = useState<string | null>(null)
    const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null)
    const [queryQuote, setQueryQuote] = useState<string | null>(null)
    const query = useDocumentQuery(path)

    /** 段末图标点击：widget 由 ProseMirror 插入，只有事件委托能拿到点击 */
    const handleContentClick = (event: MouseEvent<HTMLDivElement>): void => {
        const target = event.target
        if (!(target instanceof HTMLElement)) {
            return
        }
        const marker = target.closest('[data-annotation-block]')
        if (!(marker instanceof HTMLElement)) {
            return
        }
        const blockIndex = Number(marker.dataset.annotationBlock)
        if (Number.isNaN(blockIndex)) {
            return
        }
        const rect = marker.getBoundingClientRect()
        setNotePopover({ left: rect.left, top: rect.bottom + POPOVER_OFFSET, blockIndex })
    }

    const noteItems: readonly AnnotationRecord[] =
        notePopover === null
            ? []
            : items.filter(
                  (item) => item.kind === 'note' && item.blockIndex === notePopover.blockIndex && !item.orphaned,
              )

    return (
        <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
            <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto w-full max-w-3xl px-8 py-10" onClick={handleContentClick}>
                    <EditorContent editor={editor} />
                    <SelectionToolbar
                        editor={editor}
                        onHighlight={addOrToggleHighlight}
                        onAnnotate={(quote): void => {
                            setAnnotationQuote(quote)
                        }}
                        onQuery={(quote): void => {
                            setQueryQuote(quote)
                        }}
                    />
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground">
                <span>{status}</span>
                {isEditable ? null : <span>切换回文本编辑器可继续编辑</span>}
            </div>
            <AnnotationDialog
                isOpen={annotationQuote !== null}
                quote={annotationQuote ?? ''}
                onOpenChange={(nextOpen): void => {
                    if (!nextOpen) {
                        setAnnotationQuote(null)
                    }
                }}
                onSubmit={addNote}
            />
            <AnnotationPopover
                isOpen={notePopover !== null}
                left={notePopover?.left ?? 0}
                top={notePopover?.top ?? 0}
                items={noteItems}
                onOpenChange={(nextOpen): void => {
                    if (!nextOpen) {
                        setNotePopover(null)
                    }
                }}
                onRemove={removeAnnotation}
            />
            <QueryDialog
                isOpen={queryQuote !== null}
                quote={queryQuote ?? ''}
                onOpenChange={(nextOpen): void => {
                    if (!nextOpen) {
                        setQueryQuote(null)
                    }
                }}
                query={query}
            />
        </div>
    )
}
