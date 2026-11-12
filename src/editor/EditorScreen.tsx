/**
 * 编辑器 webview 主屏：承载 TipTap 编辑区，正文与宿主 TextDocument 双向同步，并驱动划线与批注弹层。
 * 复用约定：内容同步在 useEditorDocument，标注读写在 useAnnotations，浮层组件各自独立；
 * 段末批注图标的点击通过容器事件委托捕获（widget 是原生 DOM，不参与 React 树）。
 * 关键约束：本组件不直接发协议请求，也不决定可编辑性——只读判定来自宿主快照；
 * 状态栏必须如实展示同步状态，出现只读或同步失败时不能让用户以为内容已保存。
 */
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import UniqueID from '@tiptap/extension-unique-id'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState } from 'react'
import type { AnnotationRecord } from '@shared/types/editor'
import { BlockHandle } from './blocks/BlockHandle'
import { useAnnotations } from './hooks/useAnnotations'
import { useDocumentQuery } from './hooks/useDocumentQuery'
import { useEditorDocument } from './hooks/useEditorDocument'
import { useEditorInsert } from './hooks/useEditorInsert'
import { useEditorReveal } from './hooks/useEditorReveal'
import { useEditorSelectionReport } from './hooks/useEditorSelectionReport'
import { useEditorUpload } from './hooks/useEditorUpload'
import { useSourceMode } from './hooks/useSourceMode'
import { AnnotationDialog } from './layout/AnnotationDialog'
import { AnnotationPopover } from './layout/AnnotationPopover'
import { QueryDialog } from './layout/QueryDialog'
import { SearchPanel } from './layout/SearchPanel'
import { SelectionToolbar } from './layout/SelectionToolbar'
import { SourceEditor } from './layout/SourceEditor'
import { AnnotationExtension } from './marks/annotationExtension'
import { ZhaiImage } from './marks/ZhaiImage'
import { SearchExtension } from './search/searchExtension'
import { useDocumentSearch } from './search/useDocumentSearch'
import { EmojiPicker } from './toolbar/EmojiPicker'
import { SlashCommandExtension } from './toolbar/slashCommandExtension'
import { SlashMenu } from './toolbar/SlashMenu'
import { handleSlashKey } from './toolbar/slashStore'
import type { EditorView } from '@tiptap/pm/view'
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
        extensions: [
            StarterKit,
            // 任务列表：md 侧由 adaptTaskListHtml 转成 data-type 结构，回写由 toTaskMarkdown 还原 GFM
            TaskList,
            TaskItem.configure({ nested: true }),
            // 表格：md 侧由 adaptTableHtml 给单元格补 <p>，回写由 toTableMarkdown 拼 GFM
            TableKit.configure({ table: { resizable: false } }),
            // 图片：显示时把 @zhai/ 转成 webview 地址，序列化仍保留原始引用
            ZhaiImage.configure({ inline: false, allowBase64: false }),
            AnnotationExtension,
            SearchExtension,
            SlashCommandExtension,
            // 块运行期 id：仅用于编辑态定位（批注锚点 / 拖拽），转 Markdown 时会被丢弃，不写入正文
            UniqueID.configure({
                types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock'],
                attributeName: 'id',
            }),
        ],
        content: '<p></p>',
        editorProps: {
            attributes: {
                class: 'min-h-[60vh] text-base leading-8 outline-none',
            },
            // 斜杠菜单打开时优先消费导航键，否则方向键会被编辑器当成光标移动
            handleKeyDown: (_view: EditorView, event: KeyboardEvent): boolean => handleSlashKey(event),
        },
    })
    const { status, isEditable, path, blocks, reload, flush } = useEditorDocument(editor)
    const { items, addOrToggleHighlight, addNote, updateNote, removeAnnotation } = useAnnotations(editor, path, blocks)
    const source = useSourceMode(path, reload, flush)
    // 标注总览跳转到当前文档时，由宿主发 reveal 消息，这里负责选中与滚动
    useEditorReveal(editor)
    // 上传 / 图库插入到当前文档时，由宿主发 insert 消息，这里负责插节点或文本
    useEditorInsert(editor)
    // 编辑器内粘贴 / 拖拽文件：先上传再插引用，落盘仍归上传模块
    const upload = useEditorUpload(editor)
    // 选区上报：AI 的选区引用与写回定位靠它拿到当前选中的文字
    useEditorSelectionReport(editor, path)
    const [annotationQuote, setAnnotationQuote] = useState<string | null>(null)
    const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null)
    const [queryQuote, setQueryQuote] = useState<string | null>(null)
    const query = useDocumentQuery(path)
    const search = useDocumentSearch(editor)
    const { open: openSearch } = search

    // Ctrl/Cmd+F 打开查找：webview 内没有原生查找条，必须自己接管，否则按了没反应
    useEffect(() => {
        const handleFind = (event: KeyboardEvent): void => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                openSearch()
            }
        }
        window.addEventListener('keydown', handleFind)
        return (): void => {
            window.removeEventListener('keydown', handleFind)
        }
    }, [openSearch])

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
            {source.isSourceMode ? (
                <SourceEditor
                    content={source.content}
                    isSaving={source.isSaving}
                    error={source.error}
                    onChange={source.update}
                    onExit={source.exit}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    <div className="relative mx-auto w-full max-w-3xl px-8 py-10" onClick={handleContentClick}>
                        <EditorContent editor={editor} />
                        {editor === null ? null : <BlockHandle editor={editor} />}
                        <SlashMenu />
                        <EmojiPicker />
                        {search.isOpen ? (
                            <SearchPanel
                                query={search.query}
                                matchCount={search.matchCount}
                                activeIndex={search.activeIndex}
                                isCapped={search.isCapped}
                                onQueryChange={search.setQuery}
                                onNext={search.goNext}
                                onPrev={search.goPrev}
                                onClose={search.close}
                            />
                        ) : null}
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
            )}
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground">
                <span>{status}</span>
                {isEditable ? null : <span>切换回文本编辑器可继续编辑</span>}
                {upload.isUploading ? <span>正在上传文件…</span> : null}
                {upload.error === null ? null : <span className="text-destructive">{upload.error}</span>}
                <span className="ml-auto">Ctrl+Shift+M 源码</span>
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
                onUpdateNote={updateNote}
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
