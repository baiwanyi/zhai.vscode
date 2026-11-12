/**
 * 文档内查找：关键字命中统计、上一个 / 下一个跳转与高亮同步。
 * 复用约定：命中区间由文本节点遍历得出，高亮交给 searchExtension 的装饰插件；
 * 状态只保存「命中数 + 当前下标」，命中明细放 ref，避免每次输入都让 React 持有大数组。
 * 关键约束：命中数上限 500——未设上限时，单字查询在长章节里会产生上万个装饰，直接卡死视图；
 * 大小写不敏感，中文场景无影响，英文写作更符合直觉。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { applySearchDecorations, clearSearchDecorations } from './searchExtension'
import type { SearchMatch } from './searchExtension'
import type { Editor } from '@tiptap/react'

/** 单次查找的命中上限：超出后只提示「过多」，不再继续收集 */
const MAX_MATCHES = 500

export interface DocumentSearchState {
    isOpen: boolean
    query: string
    /** 命中总数；超过上限时为 MAX_MATCHES */
    matchCount: number
    /** 当前项下标，从 0 开始；无命中为 -1 */
    activeIndex: number
    /** 命中数是否已达上限（提示用户把关键词写具体些） */
    isCapped: boolean
}

export interface UseDocumentSearchResult extends DocumentSearchState {
    open: () => void
    close: () => void
    setQuery: (query: string) => void
    goNext: () => void
    goPrev: () => void
}

/** 遍历文本节点收集命中：大小写不敏感，跨节点不合并（换行处自然断开） */
function collectMatches(editor: Editor, query: string): SearchMatch[] {
    const matches: SearchMatch[] = []
    const needle = query.toLowerCase()
    if (needle.length === 0) {
        return matches
    }
    editor.state.doc.descendants((node, position) => {
        if (matches.length >= MAX_MATCHES) {
            return false
        }
        if (!node.isText) {
            return true
        }
        const text = node.text?.toLowerCase() ?? ''
        let index = text.indexOf(needle)
        while (index >= 0) {
            matches.push({ from: position + index, to: position + index + needle.length })
            if (matches.length >= MAX_MATCHES) {
                return false
            }
            index = text.indexOf(needle, index + needle.length)
        }
        return true
    })
    return matches
}

export function useDocumentSearch(editor: Editor | null): UseDocumentSearchResult {
    const [state, setState] = useState<DocumentSearchState>({
        isOpen: false,
        query: '',
        matchCount: 0,
        activeIndex: -1,
        isCapped: false,
    })
    const matchesRef = useRef<SearchMatch[]>([])
    const activeIndexRef = useRef(-1)

    /** 重新计算并把结果投到视图，同时滚到当前项 */
    const run = useCallback(
        (query: string, nextIndex: number): void => {
            if (editor === null) {
                return
            }
            const matches = collectMatches(editor, query)
            matchesRef.current = matches
            const isCapped = matches.length >= MAX_MATCHES
            if (matches.length === 0) {
                activeIndexRef.current = -1
                clearSearchDecorations(editor)
                setState({ isOpen: true, query, matchCount: 0, activeIndex: -1, isCapped })
                return
            }
            const activeIndex = ((nextIndex % matches.length) + matches.length) % matches.length
            activeIndexRef.current = activeIndex
            applySearchDecorations(editor, { matches, activeIndex })
            const target = matches[activeIndex]
            if (target !== undefined) {
                editor.chain().setTextSelection(target).scrollIntoView().run()
            }
            setState({ isOpen: true, query, matchCount: matches.length, activeIndex, isCapped })
        },
        [editor],
    )

    const open = useCallback((): void => {
        setState((previous) => ({ ...previous, isOpen: true }))
        if (editor !== null) {
            // 带出当前选区文本作为默认关键词，选中即搜是最常见的使用方式
            const { from, to } = editor.state.selection
            const selected = from === to ? '' : editor.state.doc.textBetween(from, to, ' ')
            if (selected !== '' && !selected.includes('\n')) {
                run(selected, 0)
            }
        }
    }, [editor, run])

    const close = useCallback((): void => {
        if (editor !== null) {
            clearSearchDecorations(editor)
            editor.commands.focus()
        }
        matchesRef.current = []
        activeIndexRef.current = -1
        setState({ isOpen: false, query: '', matchCount: 0, activeIndex: -1, isCapped: false })
    }, [editor])

    const setQuery = useCallback(
        (query: string): void => {
            run(query, 0)
        },
        [run],
    )

    const goNext = useCallback((): void => {
        run(state.query, activeIndexRef.current + 1)
    }, [run, state.query])

    const goPrev = useCallback((): void => {
        run(state.query, activeIndexRef.current - 1)
    }, [run, state.query])

    // 关闭时清空：编辑器实例不存在（如断言失败）也要复位状态
    useEffect(() => {
        return (): void => {
            matchesRef.current = []
        }
    }, [])

    return { ...state, open, close, setQuery, goNext, goPrev }
}
