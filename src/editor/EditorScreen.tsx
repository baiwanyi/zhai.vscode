/**
 * 编辑器 webview 主屏：编排 TipTap 编辑区、标注读写、查找与四类浮层。
 * 复用约定：扩展装配在 ./editorExtensions，选词在 ./selection/wordSelection，DOM 契约在 ./domContracts；
 * 文档同步、标注、对话上下文、底部续行与段末弹层各自独立成 hook，本层只负责组合与状态提升；
 * 编辑区底色、版心与空行占位样式在 ./editor.css，Tailwind 只用于状态栏与浮层。
 * 关键约束：本组件不自己拼消息、协议请求一律走 bridge 的 request，也不决定可编辑性——只读判定来自宿主快照；
 * 同步失败、只读与上传结果统一用 sonner 提示，不设常驻状态栏；
 * 源码编辑交给 VSCode 原生文本编辑器，webview 内不再提供源码模式，切走前必须 flush 防抖中的输入；
 * Ctrl/Cmd+F 与 Ctrl/Cmd+S 由 useEditorShortcuts 接管，链接的 Ctrl/Cmd+点击由 useEditorLinkClick 接管，
 * 保存前必定先 flush——autoSave 关闭时这是唯一能真正落盘的路径；
 * 批注弹窗提交期间必须保住打开时冻结的范围，写入失败时不得关闭弹窗、不得丢弃已填正文。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@components/ui/sonner'
import { preventContextMenu } from '@webview/components/dom'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import { BlockHandle } from './blocks/BlockHandle'
import { TableTools } from './blocks/TableTools'
import { EDITOR_CONTENT_CLASS, EDITOR_PAGE_CLASS, EDITOR_ROOT_CLASS, EDITOR_SCROLL_CLASS } from './domContracts'
import { createEditorExtensions } from './editorExtensions'
import { useAnnotationPopover } from './hooks/useAnnotationPopover'
import { useAnnotations } from './hooks/useAnnotations'
import { useDocumentQuery } from './hooks/useDocumentQuery'
import { useEditorChatContext } from './hooks/useEditorChatContext'
import { useEditorDocument } from './hooks/useEditorDocument'
import { useEditorInsert } from './hooks/useEditorInsert'
import { useEditorLinkClick } from './hooks/useEditorLinkClick'
import { useEditorReveal } from './hooks/useEditorReveal'
import { useEditorSelectionReport } from './hooks/useEditorSelectionReport'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'
import { useEditorUpload } from './hooks/useEditorUpload'
import { useHeadingOutline } from './hooks/useHeadingOutline'
import { useTrailingParagraph } from './hooks/useTrailingParagraph'
import { AnnotationDialog } from './layout/AnnotationDialog'
import { AnnotationPopover } from './layout/AnnotationPopover'
import { EditorLineNumbers } from './layout/EditorLineNumbers'
import { HeadingNav } from './layout/HeadingNav'
import { QueryDialog } from './layout/QueryDialog'
import { SearchPanel } from './layout/SearchPanel'
import { SelectionToolbar } from './layout/SelectionToolbar'
import { WordCountBadge } from './layout/WordCountBadge'
import { useDocumentSearch } from './search/useDocumentSearch'
import { selectWordAt } from './selection/wordSelection'
import { EmojiPicker } from './toolbar/EmojiPicker'
import { SlashMenu } from './toolbar/SlashMenu'
import { handleSlashKey } from './toolbar/slashStore'
import type { HeadingItem } from './hooks/useHeadingOutline'
import type { FrozenRange } from './toolbar/formatCommands'
import type { EditorView } from '@tiptap/pm/view'
import type { JSX } from 'react'

/** 批注提交失败：只有真正写入才关弹窗，失败要把原因说清楚，别让用户以为已经存上了 */
const MESSAGE_NOTE_FAILED = '批注未能保存：请确认选区落在同一段内且文档可编辑'

export function EditorScreen(): JSX.Element {
    // 扩展配置与文档内容无关，只构造一次；useEditor 只取首次入参，重建没有收益
    const extensions = useMemo(createEditorExtensions, [])
    const editor = useEditor({
        extensions,
        content: '<p></p>',
        editorProps: {
            attributes: {
                class: EDITOR_CONTENT_CLASS,
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
    // 正文链接只在 Ctrl / Cmd + 点击时打开，按点击坐标反查链接 mark
    useEditorLinkClick(editor)
    // 加入 AI 对话：请求前先 flush，行号换算与引用去重都在宿主侧
    const { addToChat } = useEditorChatContext(flush)
    // 批注目标：弹窗填写期间要保住引用文本与范围（弹窗夺焦后编辑器选区已经不可信）
    const [annotationTarget, setAnnotationTarget] = useState<{ quote: string; range: FrozenRange } | null>(null)
    // AI 解释的目标文本：选区工具条与块菜单共用同一条通道，弹窗不提供输入框
    const [queryQuote, setQueryQuote] = useState<string | null>(null)
    const query = useDocumentQuery(path)
    const search = useDocumentSearch(editor)
    const { open: openSearch } = search
    // Ctrl/Cmd+F 打开查找、Ctrl/Cmd+S 保存：webview 内没有原生查找条与保存入口，必须自己接管
    useEditorShortcuts(flush, openSearch)
    // 编辑区页面容器：块把手、表格工具与段末弹层都相对它定位
    const pageRef = useRef<HTMLDivElement | null>(null)
    // 段末批注弹层：点击委托、坐标测量、该块筛选与滚动收起都在 hook 内
    const annotationPopover = useAnnotationPopover(items, pageRef)
    // 正文下方空白点击：在末尾续一行可写
    const { handlePageMouseDown } = useTrailingParagraph(editor, pageRef)
    // 右侧标题导航的数据源：只认顶层 heading
    const outline = useHeadingOutline(editor)
    // 主题：sonner 的 Toaster 需要显式 light/dark，全屏只挂一次；后续新增提示直接复用
    const theme = useVscodeTheme()

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

    /** 大纲点击：光标落进标题文本并滚到可见 */
    const handleOutlineSelect = (item: HeadingItem): void => {
        if (editor === null || editor.isDestroyed) {
            return
        }
        editor
            .chain()
            .focus()
            .setTextSelection(item.pos + 1)
            .scrollIntoView()
            .run()
    }

    return (
        <div className={EDITOR_ROOT_CLASS} onContextMenu={preventContextMenu}>
            <div className={EDITOR_SCROLL_CLASS}>
                <div
                    ref={pageRef}
                    className={EDITOR_PAGE_CLASS}
                    onMouseDownCapture={handlePageMouseDown}
                    onClick={annotationPopover.handleContentClick}
                >
                    <EditorContent editor={editor} />
                    {/* 行号栏按 Markdown 真实行号逐行渲染，挂在 page 内才有正确的定位基准 */}
                    <EditorLineNumbers editor={editor} blocks={blocks} />
                    {editor === null ? null : (
                        <>
                            <BlockHandle
                                editor={editor}
                                onAskAi={(quote): void => {
                                    // 与选区工具的「查询」同一条通道：弹窗打开即发起解释查询
                                    setQueryQuote(quote)
                                }}
                                onAddToChat={(quote, blockIndex): void => {
                                    void addToChat(quote, blockIndex)
                                }}
                            />
                            <TableTools editor={editor} containerRef={pageRef} />
                        </>
                    )}
                    <SlashMenu />
                    <EmojiPicker />
                    {search.isOpen ? <SearchPanel state={search} /> : null}
                    <SelectionToolbar
                        editor={editor}
                        // 色板要按选区反查已有划线的颜色，这里直接把标注列表交下去
                        highlights={items}
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
                        onAddToChat={(quote, blockRange): void => {
                            // 行号由宿主按块偏移换算；这里只交出选区覆盖的起止块
                            void addToChat(quote, blockRange.startIndex, blockRange.endIndex)
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
                onSubmit={async (note): Promise<boolean> => {
                    // 提交时仍用打开弹窗时冻结的范围：弹窗夺焦后选区已经不可信
                    const target = annotationTarget
                    if (target === null) {
                        return false
                    }
                    const isAdded = await addNote(note, target.range)
                    if (!isAdded) {
                        toast.error(MESSAGE_NOTE_FAILED)
                        return false
                    }
                    // 成功才收起，并清掉段末弹层的残留状态，避免同块后续新增批注时自动弹出
                    setAnnotationTarget(null)
                    annotationPopover.close()
                    return true
                }}
            />
            <AnnotationPopover
                isOpen={annotationPopover.isOpen}
                left={annotationPopover.left}
                top={annotationPopover.top}
                items={annotationPopover.items}
                onOpenChange={(nextOpen): void => {
                    if (!nextOpen) {
                        annotationPopover.close()
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
