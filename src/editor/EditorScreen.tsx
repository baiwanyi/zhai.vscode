/**
 * 编辑器 webview 主屏：承载 TipTap 编辑区，正文与宿主 TextDocument 双向同步，并驱动划线与批注弹层。
 * 复用约定：内容同步在 useEditorDocument，标注读写在 useAnnotations，浮层组件各自独立；
 * 编辑区底色、版心与空行占位样式在 ./editor.css，Tailwind 只用于状态栏与浮层；
 * 块把手与表格浮动操作的定位基准都是 .zhai-editor-page（position: relative）；
 * 段末批注图标的点击通过容器事件委托捕获（widget 是原生 DOM，不参与 React 树）。
 * 关键约束：本组件不直接发协议请求，也不决定可编辑性——只读判定来自宿主快照；
 * 同步失败、只读与上传结果统一用 sonner 提示，不设常驻状态栏；
 * 源码编辑交给 VSCode 原生文本编辑器，webview 内不再提供源码模式，切走前必须 flush 防抖中的输入；
 * Ctrl/Cmd+S 由本层接管：先 flush 再请宿主 document.save()，autoSave 关闭时才有真正的落盘路径。
 */
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import UniqueID from '@tiptap/extension-unique-id'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@components/ui/sonner'
import type { AnnotationRecord } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import { BlockHandle } from './blocks/BlockHandle'
import { TableTools } from './blocks/TableTools'
import { useAnnotations } from './hooks/useAnnotations'
import { useDocumentQuery } from './hooks/useDocumentQuery'
import { useEditorDocument } from './hooks/useEditorDocument'
import { useEditorInsert } from './hooks/useEditorInsert'
import { useEditorReveal } from './hooks/useEditorReveal'
import { useEditorSelectionReport } from './hooks/useEditorSelectionReport'
import { useEditorUpload } from './hooks/useEditorUpload'
import { useHeadingOutline } from './hooks/useHeadingOutline'
import { AnnotationDialog } from './layout/AnnotationDialog'
import { AnnotationPopover } from './layout/AnnotationPopover'
import { HeadingNav } from './layout/HeadingNav'
import { QueryDialog } from './layout/QueryDialog'
import { SearchPanel } from './layout/SearchPanel'
import { SelectionToolbar } from './layout/SelectionToolbar'
import { WordCountBadge } from './layout/WordCountBadge'
import { AnnotationExtension } from './marks/annotationExtension'
import { CursorLineExtension } from './marks/cursorLineExtension'
import { ZhaiImage } from './marks/ZhaiImage'
import { SearchExtension } from './search/searchExtension'
import { useDocumentSearch } from './search/useDocumentSearch'
import { EmojiPicker } from './toolbar/EmojiPicker'
import { SlashCommandExtension } from './toolbar/slashCommandExtension'
import { SlashMenu } from './toolbar/SlashMenu'
import { handleSlashKey } from './toolbar/slashStore'
import type { HeadingItem } from './hooks/useHeadingOutline'
import type { FrozenRange } from './toolbar/formatCommands'
import type { EditorView } from '@tiptap/pm/view'
import type { JSX, MouseEvent } from 'react'

/** 段末图标与气泡之间的间距 */
const POPOVER_OFFSET = 4

/**
 * 双击选词：按词边界选中命中的片段。
 * ProseMirror 默认按空白切分，一整段中文没有空白可切，双击会一路扩成整段——
 * 表现就是「双击把当前行全选了」。Chromium 自带 Intl.Segmenter，缺失时回落到默认处理。
 */
function selectWordAt(view: EditorView, pos: number): boolean {
    if (typeof Intl.Segmenter !== 'function') {
        return false
    }
    const $pos = view.state.doc.resolve(pos)
    if (!$pos.parent.inlineContent) {
        return false
    }
    const blockStart = $pos.start()
    const text = $pos.parent.textContent
    const offset = pos - blockStart
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const item of segmenter.segment(text)) {
        if (offset < item.index || offset > item.index + item.segment.length) {
            continue
        }
        const from = blockStart + item.index
        const to = from + item.segment.length
        if (from >= to) {
            continue
        }
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
        return true
    }
    return false
}

interface NotePopoverState {
    left: number
    top: number
    blockIndex: number
}

/** AI 解释的目标文本：两个入口都只传文本，弹窗自己按固定问题发起查询 */

export function EditorScreen(): JSX.Element {
    const editor = useEditor({
        extensions: [
            // 链接：预置在 StarterKit 里，关掉点击跳转与自动识别，避免点正文里的链接就跳出编辑器、
            // 也避免敲一个裸 URL 就把纯文本改写成链接语法
            StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
            // 空行占位提示：装饰只落在光标所在的空文本块上，形态见 editor.css 的 .is-empty
            Placeholder.configure({ placeholder: "Write, type '/' for commands…" }),
            // 任务列表：md 侧由 adaptTaskListHtml 转成 data-type 结构，回写由 toTaskMarkdown 还原 GFM
            TaskList,
            TaskItem.configure({ nested: true }),
            // 表格：md 侧由 adaptTableHtml 给单元格补 <p>，回写由 toTableMarkdown 拼 GFM
            TableKit.configure({ table: { resizable: false } }),
            // 图片：显示时把 @zhai/ 转成 webview 地址，序列化仍保留原始引用
            ZhaiImage.configure({ inline: false, allowBase64: false }),
            AnnotationExtension,
            // 当前行：给光标所在块挂 class，editor.css 据此高亮左侧行号
            CursorLineExtension,
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
                class: 'zhai-editor-content',
            },
            // 双击选中一个词：默认切分在无空白的中文里会直接扩到整段
            handleDoubleClick: (view: EditorView, pos: number): boolean => selectWordAt(view, pos),
            // 斜杠菜单打开时优先消费导航键，否则方向键会被编辑器当成光标移动
            handleKeyDown: (_view: EditorView, event: KeyboardEvent): boolean => handleSlashKey(event),
        },
    })
    const { path, blocks, flush } = useEditorDocument(editor)
    const { items, addOrToggleHighlight, applyHighlightColor, addNote, updateNote, removeAnnotation } = useAnnotations(
        editor,
        path,
        blocks,
    )
    // 标注总览跳转到当前文档时，由宿主发 reveal 消息，这里负责选中与滚动
    useEditorReveal(editor)
    // 上传 / 图库插入到当前文档时，由宿主发 insert 消息，这里负责插节点或文本
    useEditorInsert(editor)
    // 编辑器内粘贴 / 拖拽文件：先上传再插引用，进度与结果由上传 hook 走 sonner 提示
    useEditorUpload(editor)
    // 选区上报：AI 的选区引用与写回定位靠它拿到当前选中的文字
    useEditorSelectionReport(editor, path)
    // 批注目标：弹窗填写期间要保住引用文本与范围（弹窗夺焦后编辑器选区已经不可信）
    const [annotationTarget, setAnnotationTarget] = useState<{ quote: string; range: FrozenRange } | null>(null)
    const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null)
    // AI 解释的目标文本：选区工具条与块菜单共用同一条通道，弹窗不提供输入框
    const [queryQuote, setQueryQuote] = useState<string | null>(null)
    const query = useDocumentQuery(path)
    const search = useDocumentSearch(editor)
    const { open: openSearch } = search
    // 编辑区页面容器：块把手与表格工具都相对它定位
    const pageRef = useRef<HTMLDivElement | null>(null)
    // 右侧标题导航的数据源：只认顶层 heading
    const outline = useHeadingOutline(editor)
    // 块菜单的复制结果要弹提示：Toaster 只在本层挂一次，后续有新的提示需求直接复用
    const theme = useVscodeTheme()

    /**
     * 显式保存：webview 内没有 VSCode 的保存命令，Ctrl/Cmd+S 必须自己接管。
     * 先把防抖窗口里的输入回写进 TextDocument，再让宿主落盘——autoSave 关闭时这是唯一能真正写文件的路径。
     */
    const handleSave = useCallback(async (): Promise<void> => {
        await flush()
        try {
            const result = await request<{ saved: boolean }>('editor/save')
            if (!result.saved) {
                toast.error('保存失败：请确认文件未被占用或设为只读')
            }
        } catch {
            // 宿主未就绪或超时：与落盘失败同一套文案，不让用户猜是没保存还是没反应
            toast.error('保存失败：请确认文件未被占用或设为只读')
        }
    }, [flush])

    // Ctrl/Cmd+F 打开查找、Ctrl/Cmd+S 保存：webview 内没有原生查找条与保存入口，必须自己接管
    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent): void => {
            if (!event.ctrlKey && !event.metaKey) {
                return
            }
            const key = event.key.toLowerCase()
            if (key === 'f') {
                event.preventDefault()
                openSearch()
                return
            }
            if (key === 's') {
                event.preventDefault()
                void handleSave()
            }
        }
        window.addEventListener('keydown', handleShortcut)
        return (): void => {
            window.removeEventListener('keydown', handleShortcut)
        }
    }, [handleSave, openSearch])

    // 切到文本编辑器或其它标签页前先落盘：回写防抖窗口里的输入不能随 webview 一起被挂起
    useEffect(() => {
        const handleHidden = (): void => {
            if (document.visibilityState === 'hidden') {
                void flush()
            }
        }
        document.addEventListener('visibilitychange', handleHidden)
        return (): void => {
            document.removeEventListener('visibilitychange', handleHidden)
        }
    }, [flush])

    /**
     * 正文链接只在 Ctrl / Cmd + 点击时打开。
     * 链接元素已被 CSS 关了指针命中（pointer-events: none），单击打不到 a 上，
     * webview 的链接处理也就不会跳转；这里按点击坐标反查链接 mark 拿地址。
     */
    useEffect(() => {
        if (editor === null) {
            return
        }
        const handleClick = (event: Event): void => {
            if (!(event instanceof globalThis.MouseEvent)) {
                return
            }
            if (!event.ctrlKey && !event.metaKey) {
                return
            }
            const linkType = editor.schema.marks.link
            if (linkType === undefined) {
                return
            }
            const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (at === null) {
                return
            }
            const resolved = editor.state.doc.resolve(at.pos)
            const mark = linkType.isInSet(resolved.marks())
            if (mark === undefined) {
                return
            }
            const attributes: Record<string, unknown> = mark.attrs
            const href = attributes.href
            if (typeof href === 'string' && href.length > 0) {
                void request('editor/openLink', { url: href }).catch((): void => undefined)
            }
        }
        document.addEventListener('click', handleClick, true)
        return (): void => {
            document.removeEventListener('click', handleClick, true)
        }
    }, [editor])

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

    /** 大纲点击：光标落进标题文本并滚到可见 */
    const handleOutlineSelect = (item: HeadingItem): void => {
        if (editor === null) {
            return
        }
        editor
            .chain()
            .focus()
            .setTextSelection(item.pos + 1)
            .scrollIntoView()
            .run()
    }

    const noteItems: readonly AnnotationRecord[] =
        notePopover === null
            ? []
            : items.filter(
                  (item) => item.kind === 'note' && item.blockIndex === notePopover.blockIndex && !item.orphaned,
              )

    return (
        <div className="zhai-editor" onContextMenu={(event) => event.preventDefault()}>
            <div className="zhai-editor-scroll">
                <div ref={pageRef} className="zhai-editor-page" onClick={handleContentClick}>
                    <EditorContent editor={editor} />
                    {editor === null ? null : (
                        <BlockHandle
                            editor={editor}
                            onAskAi={(quote): void => {
                                // 与选区工具的「查询」同一条通道：弹窗打开即发起解释查询
                                setQueryQuote(quote)
                            }}
                        />
                    )}
                    {editor === null ? null : <TableTools editor={editor} containerRef={pageRef} />}
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
                        onHighlightColor={applyHighlightColor}
                        onAnnotate={(quote, range): void => {
                            setAnnotationTarget({ quote, range })
                        }}
                        onCommitted={(): void => {
                            // 链接是低频操作，改完立刻落盘，不必等 500ms 防抖；
                            // 失败提示统一由 flush 内部给出，避免两处各弹一条
                            void flush()
                        }}
                        onQuery={(quote): void => {
                            setQueryQuote(quote)
                        }}
                    />
                </div>
            </div>
            {/* 大纲挂在滚动区之外：定位基准是 .zhai-editor，不会随正文滚走 */}
            <HeadingNav items={outline} onSelect={handleOutlineSelect} />
            <WordCountBadge editor={editor} />
            <AnnotationDialog
                isOpen={annotationTarget !== null}
                quote={annotationTarget?.quote ?? ''}
                onOpenChange={(nextOpen): void => {
                    if (!nextOpen) {
                        setAnnotationTarget(null)
                    }
                }}
                onSubmit={async (note): Promise<void> => {
                    // 提交时仍用打开弹窗时冻结的范围：弹窗夺焦后选区已经不可信
                    const target = annotationTarget
                    if (target === null) {
                        return
                    }
                    setAnnotationTarget(null)
                    await addNote(note, target.range)
                }}
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
            <Toaster theme={theme} />
        </div>
    )
}
