/**
 * 文档内查找：关键字命中统计、上一个 / 下一个跳转与高亮同步。
 * 复用约定：命中区间由文本节点遍历得出，高亮交给 searchExtension 的装饰插件；
 * 状态只保存「命中数 + 当前下标」，命中明细放 ref，避免每次输入都让 React 持有大数组。
 * 关键约束：命中数上限 500——未设上限时，单字查询在长章节里会产生上万个装饰，直接卡死视图；
 * 输入按 SEARCH_DEBOUNCE_MS 防抖后才遍历与重建装饰，跳转前必须先把窗口里的输入结算掉，
 * 否则跳的是上一个关键词的命中；大小写不敏感，中文场景无影响，英文写作更符合直觉。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { applySearchDecorations, clearSearchDecorations } from './searchExtension'
import type { SearchMatch } from './searchExtension'
import type { Editor } from '@tiptap/react'

/** 单次查找的命中上限：超出后只提示「过多」，不再继续收集 */
const MAX_MATCHES = 500

/** 输入防抖：长文档每次击键都全量遍历并重建装饰会让输入发涩，停顿后再查一次 */
const SEARCH_DEBOUNCE_MS = 150

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
    /** 输入防抖定时器：关闭与卸载都要清，否则查找条关了还会跑一次 run 把状态顶回打开 */
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** 还在防抖窗口里的关键词：跳转前先结算它，不能拿旧关键词去跳 */
    const pendingQueryRef = useRef<string | null>(null)

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

    /** 丢掉防抖窗口里的输入：关闭、重新打开与卸载都走这里 */
    const clearPendingQuery = useCallback((): void => {
        pendingQueryRef.current = null
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    /** 结算防抖窗口里的输入：返回是否消费了一次待执行的查询（有则已立即执行） */
    const runPendingQuery = useCallback((): boolean => {
        const pending = pendingQueryRef.current
        if (pending === null) {
            return false
        }
        clearPendingQuery()
        run(pending, 0)
        return true
    }, [clearPendingQuery, run])

    const open = useCallback((): void => {
        // 上一次输入若还压在防抖窗口里，先丢掉：打开是按当前选区重新开始
        clearPendingQuery()
        setState((previous) => ({ ...previous, isOpen: true }))
        if (editor !== null) {
            // 带出当前选区文本作为默认关键词，选中即搜是最常见的使用方式
            const { from, to } = editor.state.selection
            // 用换行拼接块间内容：跨块选区会带上 \n，据此按原意图跳过（空格拼接会让该判断恒为假）
            const selected = from === to ? '' : editor.state.doc.textBetween(from, to, '\n')
            if (selected !== '' && !selected.includes('\n')) {
                run(selected, 0)
            }
        }
    }, [clearPendingQuery, editor, run])

    const close = useCallback((): void => {
        // 关掉时把窗口里的输入一起丢掉：run 会把 isOpen 重新置 true，留着等于没关
        clearPendingQuery()
        if (editor !== null) {
            clearSearchDecorations(editor)
            editor.commands.focus()
        }
        matchesRef.current = []
        activeIndexRef.current = -1
        setState({ isOpen: false, query: '', matchCount: 0, activeIndex: -1, isCapped: false })
    }, [clearPendingQuery, editor])

    /**
     * 输入防抖：每个字符都遍历全文并重建装饰会让长文档输入发涩，停顿后再落一次。
     * 关键词本身必须同步回显——输入框是受控的，只改 pending 会让父层任何一次重渲染把刚敲的字吞掉。
     */
    const setQuery = useCallback(
        (nextQuery: string): void => {
            setState((previous) => ({ ...previous, query: nextQuery }))
            pendingQueryRef.current = nextQuery
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
            }
            timerRef.current = setTimeout((): void => {
                timerRef.current = null
                pendingQueryRef.current = null
                run(nextQuery, 0)
            }, SEARCH_DEBOUNCE_MS)
        },
        [run],
    )

    const goNext = useCallback((): void => {
        // 输入还在窗口里时先结算：否则跳的是上一个关键词的命中
        if (runPendingQuery()) {
            return
        }
        run(state.query, activeIndexRef.current + 1)
    }, [run, runPendingQuery, state.query])

    const goPrev = useCallback((): void => {
        if (runPendingQuery()) {
            return
        }
        run(state.query, activeIndexRef.current - 1)
    }, [run, runPendingQuery, state.query])

    // 关闭时清空：编辑器实例不存在（如断言失败）也要复位状态
    useEffect(() => {
        return (): void => {
            matchesRef.current = []
            clearPendingQuery()
        }
    }, [clearPendingQuery])

    return { ...state, open, close, setQuery, goNext, goPrev }
}
