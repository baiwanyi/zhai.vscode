/**
 * 正文下方空白续行：点击页面底部空白时在文档末尾补一个空段落并落光标。
 * 复用约定：只依赖 editor 实例与版心容器引用，容器由调用方注入（块把手、表格工具共用同一个引用）。
 * 关键约束：只接管主键、命中空白容器本身、且落点低于最后一个块的点击——正文块内空隙交给 ProseMirror；
 * 末块是表格 / 图片时光标无处可写，必须先补段落才「点得进去」；
 * 接管后必须 preventDefault，否则 ProseMirror 还会按坐标把光标贴回最后一块。
 */
import { TextSelection } from '@tiptap/pm/state'
import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import type { MouseEvent, RefObject } from 'react'
import { EDITOR_SCROLL_CLASS } from '../core/domContracts'

export interface UseTrailingParagraphResult {
    handlePageMouseDown: (event: MouseEvent<HTMLDivElement>) => void
}

export function useTrailingParagraph(
    editor: Editor | null,
    pageRef: RefObject<HTMLDivElement | null>,
): UseTrailingParagraphResult {
    /**
     * 续行到文档末尾：末尾已有空段落时只把光标放进去，否则补一个空段落再落光标。
     * 末块是表格、图片这类非文本块时光标无处可写，必须先补段落才「点得进去」。
     */
    const appendTrailingParagraph = useCallback((): void => {
        if (editor === null || editor.isDestroyed || !editor.isEditable) {
            return
        }
        const { doc } = editor.state
        const end = doc.content.size
        const last = doc.lastChild
        if (last !== null && last.type.name === 'paragraph' && last.content.size === 0) {
            const selection = TextSelection.near(doc.resolve(end))
            editor.chain().focus().setTextSelection(selection.from).scrollIntoView().run()
            return
        }
        editor
            .chain()
            .focus()
            .insertContentAt(end, { type: 'paragraph' })
            .setTextSelection(end + 1)
            .scrollIntoView()
            .run()
    }, [editor])

    /**
     * 正文下方空白点击：在末尾续一行可写。
     * 只接管「命中空白容器本身」且落点低于最后一个块的点击——正文块内的空隙交给 ProseMirror，
     * 浮动工具（表格加号、块把手、菜单）的点击命中它们自己的元素，不会被这里拦掉。
     */
    const handlePageMouseDown = useCallback(
        (event: MouseEvent<HTMLDivElement>): void => {
            // 只认主键：右键 / 中键落在空白处不该凭空补出一行
            if (event.button !== 0) {
                return
            }
            if (editor === null || editor.isDestroyed || !editor.isEditable) {
                return
            }
            const target = event.target
            const page = pageRef.current
            if (!(target instanceof Element) || page === null) {
                return
            }
            const content = editor.view.dom
            const isBlankHost = target === content || target === page || target.classList.contains(EDITOR_SCROLL_CLASS)
            if (!isBlankHost) {
                return
            }
            const lastBlock = content.lastElementChild
            if (lastBlock === null || event.clientY < lastBlock.getBoundingClientRect().bottom) {
                return
            }
            event.preventDefault()
            appendTrailingParagraph()
        },
        [appendTrailingParagraph, editor, pageRef],
    )

    return { handlePageMouseDown }
}
