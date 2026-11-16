/**
 * 搜索关键词状态：页面头部常驻搜索框的受控值，供列表过滤与跨笔记本搜索共用。
 * 复用 useState 承载单一字符串，不引入额外状态机；变更回调可选，用于把「关键词变了」这一事实通知给外部状态。
 * 关键约束：关键词保留用户原样输入（不吞中间空格），清空动作只复位为空串；
 * 回调仅在同一次输入真的改变了关键词时触发，重复输入同一个值不重复通知；
 * 进入多选不清空关键词，避免多选期间丢失过滤条件。
 */
import { useCallback, useState } from 'react'

export interface NotesSearchState {
    query: string
    changeQuery: (value: string) => void
    clear: () => void
}

export function useNoteQuery(onQueryChange?: (next: string) => void): NotesSearchState {
    const [query, setQuery] = useState('')
    /** 只在值真的变化时通知外部：列表来源一旦切换，外部得以及时作废依赖旧结果的选中状态 */
    const changeQuery = useCallback(
        (value: string): void => {
            if (value !== query) {
                onQueryChange?.(value)
            }
            setQuery(value)
        },
        [onQueryChange, query],
    )
    const clear = useCallback((): void => changeQuery(''), [changeQuery])
    return { query, changeQuery, clear }
}
