/**
 * 代码高亮 Hook：把流式到达的代码文本转成逐行高亮结果。
 * 复用约定：语言包加载与分词统一走 components/lib/highlighter，状态用 useState / useRef 管理。
 * 关键约束：流式场景只对新增行分词并沿用上一次语法状态；语言切换时丢弃旧结果，
 * 加载失败静默回退纯文本，异常不得冒泡到渲染层。
 */
import * as React from 'react'

import { loadHighlighter } from '@components/lib/highlighter'

export function useHighlightedCode(value: string, language: string) {
    // A trailing newline would render as an extra empty line.
    const code = value.endsWith('\n') ? value.slice(0, -1) : value
    const [loaded, setLoaded] = React.useState<{
        language: string
        highlighter: Awaited<ReturnType<typeof loadHighlighter>>
    } | null>(null)
    const highlighter = loaded?.language === language ? loaded.highlighter : null

    React.useEffect(() => {
        let cancelled = false

        loadHighlighter(language)
            .then((next) => {
                if (!cancelled) {
                    setLoaded({ language, highlighter: next })
                }
            })
            .catch(() => {})

        return () => {
            cancelled = true
        }
    }, [language])

    // The complete lines, highlighted. While the code streams, only the new
    // lines are tokenized, starting from the grammar state of the last one.
    const [done, setDone] = React.useState<{
        highlighter: typeof highlighter
        text: string
        lines: React.ReactNode[]
        state?: Parameters<NonNullable<typeof highlighter>['highlight']>[1]
    }>({ highlighter: null, text: '', lines: [] })

    let next = done

    if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
        next = { highlighter, text: '', lines: [] }
    }

    const end = code.lastIndexOf('\n') + 1

    if (highlighter && end > next.text.length) {
        const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state)

        next = {
            highlighter,
            text: code.slice(0, end),
            lines: [...next.lines, ...result.lines],
            state: result.state,
        }
    }

    if (next !== done) {
        setDone(next)
    }

    // The last line is still being written, so it is tokenized on every render.
    const tail = code.slice(end)

    return React.useMemo(() => {
        if (!highlighter) {
            return code.split('\n')
        }

        return [...next.lines, highlighter.highlight(tail, next.state).lines[0]]
    }, [code, highlighter, next, tail])
}
