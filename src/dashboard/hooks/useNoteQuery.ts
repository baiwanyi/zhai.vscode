/**
 * 搜索关键词状态：页面头部常驻搜索框的受控值，供列表过滤与跨笔记本搜索共用。
 * 复用 useState 承载单一字符串，不引入额外状态机。
 * 关键约束：关键词保留用户原样输入（不吞中间空格），清空动作只复位为空串；
 * 进入多选不清空关键词，避免多选期间丢失过滤条件。
 */
import { useCallback, useState } from 'react'

export interface NotesSearchState {
    query: string
    changeQuery: (value: string) => void
    clear: () => void
}

export function useNoteQuery(): NotesSearchState {
    const [query, setQuery] = useState('')
    const changeQuery = useCallback((value: string): void => setQuery(value), [])
    const clear = useCallback((): void => setQuery(''), [])
    return { query, changeQuery, clear }
}
