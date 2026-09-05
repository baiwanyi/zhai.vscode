/**
 * 全局搜索面板：Ctrl+K 跨模块搜索占位实现（输入 → FTS5 检索 → 分组高亮结果）。
 * 数据流：request('search/query') → 宿主 SQLite 查询 → 响应渲染；结果跳转能力后续接入各模块。
 * 安全约束：宿主 snippet 以【】标注命中，本组件用 React 节点渲染高亮，禁止 dangerouslySetInnerHTML。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { request } from './bridge'

interface SearchHit {
    path: string
    title: string
    tags: string[]
    snippet: string
}

interface IndexStatus {
    indexedCount: number
    lastBuiltAt: string | null
    isRebuilding: boolean
}

/** 按模块目录分组（notes / press / reader / 其他），对应 common.md C7 分组展示要求 */
// function groupByModule(hits: SearchHit[]): Array<[string, SearchHit[]]> {
//     const groups: Map<string, SearchHit[]> = new Map()
//     for (const hit of hits) {
//         const module = hit.path.split('/')[0] ?? 'other'
//         const list = groups.get(module) ?? []
//         list.push(hit)
//         groups.set(module, list)
//     }
//     return [...groups.entries()]
// }

/** 将宿主【】高亮标记转换为 React 节点，避免 HTML 注入 */
// function HighlightedSnippet({ text }: { text: string }): JSX.Element {
//     const parts = text.split(/【|】/g)
//     // split 后偶数下标为普通文本，奇数下标为命中片段
//     return (
//         <>
//             {parts.map((part, index) =>
//                 index % 2 === 1 ? (
//                     <mark key={index} className="rounded bg-yellow-500/40 px-0.5">
//                         {part}
//                     </mark>
//                 ) : (
//                     <span key={index}>{part}</span>
//                 ),
//             )}
//         </>
//     )
// }

export function SearchPanel(): JSX.Element {
    // const [keyword, setKeyword] = useState('')
    // const [hits, setHits] = useState<SearchHit[]>([])
    // const [status, setStatus] = useState<IndexStatus | null>(null)
    // const [error, setError] = useState<string | null>(null)

    // useEffect(() => {
    //     void request<IndexStatus>('index/status')
    //         .then(setStatus)
    //         .catch((e: Error) => setError(e.message))
    // }, [])

    // const handleSearch = useCallback((value: string): void => {
    //     setKeyword(value)
    //     if (value.trim().length === 0) {
    //         setHits([])
    //         return
    //     }
    //     void request<SearchHit[]>('search/query', value)
    //         .then((results) => {
    //             setHits(results)
    //             setError(null)
    //         })
    //         .catch((e: Error) => setError(e.message))
    // }, [])

    // const groups = useMemo(() => groupByModule(hits), [hits])

    // return (
    //     <div className="flex h-full flex-col gap-2 p-3 text-sm">
    //         <input
    //             type="text"
    //             value={keyword}
    //             onChange={(e) => handleSearch(e.target.value)}
    //             placeholder="搜索笔记 / 章节 / 书籍…"
    //             className="w-full rounded-md border border-black/30 bg-white/5 px-2 py-1.5 outline-none focus:border-blue-400"
    //         />
    //         {error !== null && <p className="text-red-500">{error}</p>}
    //         {status !== null && (
    //             <p className="text-xs opacity-60">
    //                 已索引 {status.indexedCount} 个文件
    //                 {status.lastBuiltAt !== null ? ` · 上次构建 ${new Date(status.lastBuiltAt).toLocaleString()}` : ''}
    //                 {status.isRebuilding ? ' · 重建中…' : ''}
    //             </p>
    //         )}
    //         <div className="flex-1 overflow-y-auto">
    //             {groups.length === 0 && keyword.length > 0 && <p className="opacity-60">无匹配结果</p>}
    //             {groups.map(([module, items]) => (
    //                 <div key={module} className="mb-3">
    //                     <h3 className="mb-1 text-xs font-semibold uppercase opacity-70">{module}</h3>
    //                     <ul>
    //                         {items.map((hit) => (
    //                             <li
    //                                 key={hit.path}
    //                                 className="cursor-pointer rounded px-2 py-1.5 hover:bg-white/5"
    //                                 title={hit.path}
    //                             >
    //                                 <p className="font-medium">{hit.title}</p>
    //                                 <p className="text-xs opacity-70">
    //                                     <HighlightedSnippet text={hit.snippet} />
    //                                 </p>
    //                             </li>
    //                         ))}
    //                     </ul>
    //                 </div>
    //             ))}
    //         </div>
    //     </div>
    // )

    return (<p>此页面功能正在开发中，敬请期待</p>);
}
