/**
 * 笔记本视图状态：把宿主下发的笔记本快照整理成可渲染的分组列表，并维护展开集合、排序与组内笔记缓存。
 * 复用 @shared/utils/bridge 按需读取组内笔记，排序口径与宿主 notebookService 保持一致（置顶优先、再按偏好方式）。
 * 关键约束：展开与排序先在本地生效再落库，落库失败仅当本地值未被后续操作覆盖时回滚，避免界面与偏好长期分叉；
 * 组内笔记只在展开时读取，宿主快照变化后重新拉取已展开的组，使删除、恢复与改名后的列表立即收敛；
 * 同一组的并发刷新合并为一次在途请求并在结束后补刷，避免旧响应覆盖新结果与快照抖动造成请求风暴；
 * 已消失笔记本的组内缓存随快照剔除；首次进入且宿主没有记录任何展开项时自动展开默认笔记本，
 * 纯本地行为，不写回偏好，用户点「全部收起」后不再自动展开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardStats, RecentFile } from '@shared/types/dashboard'
import type { ListNotebookNotesResult, NotebookSort, NotebookSummary } from '@shared/types/notebook'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { NotebookNotesEntry } from '../note/types'

/** 空集合常量：避免每次渲染新建数组导致下游 memo 失效；声明为只读，防止下游原地改写污染常量 */
const EMPTY_IDS: readonly string[] = []
const EMPTY_NOTES: readonly RecentFile[] = []

/** 默认排序：与宿主保持一致，最近动过的笔记本优先 */
const DEFAULT_SORT: NotebookSort = 'mtime'

/** 笔记本动作：由页面从 useDashboardActions 传入，返回是否落库成功 */
export interface NotebookActions {
    setNotebookSort: (sort: NotebookSort) => Promise<boolean>
    setNotebookOpen: (ids: string[]) => Promise<boolean>
}

export interface NotebooksState {
    /** 已按当前排序与置顶规则排好序 */
    notebooks: NotebookSummary[]
    sort: NotebookSort
    openIds: readonly string[]
    /** 已加载的组内笔记（含未展开的历史缓存），供页面反查标题 */
    allNotes: readonly RecentFile[]
    isOpen: (id: string) => boolean
    notesOf: (id: string) => NotebookNotesEntry | null
    toggleOpen: (id: string) => void
    collapseAll: () => void
    changeSort: (sort: NotebookSort) => void
}

/** 排序：置顶项成组在前，组内按偏好方式排，名称兜底保证顺序稳定（与宿主同口径） */
function sortNotebooks(list: NotebookSummary[], sort: NotebookSort, pinnedIds: readonly string[]): NotebookSummary[] {
    const pinned = new Set(pinnedIds)
    return [...list].sort((a, b) => {
        const isPinnedA = pinned.has(a.id)
        const isPinnedB = pinned.has(b.id)
        if (isPinnedA !== isPinnedB) {
            return isPinnedA ? -1 : 1
        }
        if (sort === 'mtime' && a.mtime !== b.mtime) {
            return a.mtime < b.mtime ? 1 : -1
        }
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })
}

export function useNotebooks(stats: DashboardStats | null, actions: NotebookActions): NotebooksState {
    /** 本地排序：null 表示跟随宿主；用户切换后一直以本地为准，避免刷新时来回跳 */
    const [localSort, setLocalSort] = useState<NotebookSort | null>(null)
    /** 本地展开集合：null 表示跟随宿主，语义与 localSort 相同 */
    const [localOpenIds, setLocalOpenIds] = useState<string[] | null>(null)
    const [notes, setNotes] = useState<Record<string, NotebookNotesEntry>>({})
    /** 首次自动展开只做一次，用户主动收起后不再干预 */
    const didAutoOpenRef = useRef(false)
    /** effect 里读最新的展开集合，避免把它写进依赖导致展开即重复请求 */
    const openIdsRef = useRef<readonly string[]>(EMPTY_IDS)
    /** 在途请求的笔记本 id：同一组重入时不并发发出，改记为待补刷 */
    const inFlightRef = useRef<Set<string>>(new Set())
    /** 在途期间又被要求刷新的笔记本 id：当前请求结束后补一次，避免快照抖动丢更新 */
    const pendingIdsRef = useRef<Set<string>>(new Set())
    /** 卸载后不再写状态，避免面板关闭后仍落在已废弃的树上 */
    const isDisposedRef = useRef(false)

    const sort = localSort ?? stats?.notebookPrefs.sort ?? DEFAULT_SORT
    const openIds = localOpenIds ?? stats?.notebookPrefs.openIds ?? EMPTY_IDS
    openIdsRef.current = openIds

    const notebooks = useMemo(() => {
        const list = stats?.notebooks ?? []
        const pinnedIds = list.filter((notebook) => notebook.isPinned).map((notebook) => notebook.id)
        return sortNotebooks(list, sort, pinnedIds)
    }, [sort, stats])

    // 卸载标记：组件重挂载（含 StrictMode 双执行）时重新打开，避免卸载后仍写状态
    useEffect(() => {
        isDisposedRef.current = false
        return (): void => {
            isDisposedRef.current = true
        }
    }, [])

    const loadNotes = useCallback(async (id: string): Promise<void> => {
        if (inFlightRef.current.has(id)) {
            // 同一组已有在途请求：只记待补刷，等当前请求结束再拉一次，避免后发先至覆盖新结果
            pendingIdsRef.current.add(id)
            return
        }
        inFlightRef.current.add(id)
        try {
            do {
                pendingIdsRef.current.delete(id)
                setNotes((previous) => ({
                    ...previous,
                    [id]: { status: 'loading', items: previous[id]?.items ?? [], error: null },
                }))
                try {
                    const result = await request<ListNotebookNotesResult>('notebook/notes', { id })
                    if (isDisposedRef.current) {
                        return
                    }
                    setNotes((previous) => ({
                        ...previous,
                        [id]: { status: 'ready', items: result.items, error: null },
                    }))
                } catch (cause) {
                    if (isDisposedRef.current) {
                        return
                    }
                    // 失败保留上一次结果：错误态由列表层呈现，恢复后立即可见，页面反查标题也不至于落空
                    setNotes((previous) => ({
                        ...previous,
                        [id]: { status: 'error', items: previous[id]?.items ?? [], error: toErrorText(cause) },
                    }))
                }
            } while (pendingIdsRef.current.has(id) && !isDisposedRef.current)
        } finally {
            inFlightRef.current.delete(id)
        }
    }, [])

    // 宿主快照变化（增删改、外部编辑）后重新拉取已展开的组，保证组内笔记不落后于磁盘；
    // 同时剔除已消失笔记本的缓存，避免 allNotes 长期残留已删除笔记的标题与置顶事实
    useEffect(() => {
        if (stats === null) {
            return
        }
        const existingIds = new Set(stats.notebooks.map((notebook) => notebook.id))
        setNotes((previous) => {
            const staleIds = Object.keys(previous).filter((id) => !existingIds.has(id))
            if (staleIds.length === 0) {
                return previous
            }
            const next = { ...previous }
            for (const id of staleIds) {
                delete next[id]
            }
            return next
        })
        for (const id of openIdsRef.current) {
            // 已删除笔记本的 id 可能残留在宿主偏好里，直接发请求只会白跑一趟
            if (existingIds.has(id)) {
                void loadNotes(id)
            }
        }
    }, [stats, loadNotes])

    // 首次进入且宿主没有任何展开记录时展开默认笔记本：只是本地展开，不写回偏好
    useEffect(() => {
        if (didAutoOpenRef.current || stats === null) {
            return
        }
        didAutoOpenRef.current = true
        if (stats.notebookPrefs.openIds.length > 0) {
            return
        }
        const defaultId = stats.notebookPrefs.defaultId
        if (defaultId === null) {
            return
        }
        setLocalOpenIds([defaultId])
        void loadNotes(defaultId)
    }, [stats, loadNotes])

    /**
     * 切换展开：先本地生效再落库。
     * 回滚只在本地值仍是本次写入值时才执行（期间用户可能有新操作），且恢复为操作前的本地值——
     * 若此前是 null 表示仍跟随宿主，不能退化成宿主旧快照，否则本地状态会永久接管。
     */
    const toggleOpen = useCallback(
        (id: string): void => {
            const previous = openIds
            const previousLocal = localOpenIds
            const isOpen = previous.includes(id)
            const next = isOpen ? previous.filter((item) => item !== id) : [...previous, id]
            setLocalOpenIds(next)
            if (!isOpen) {
                void loadNotes(id)
            }
            void actions.setNotebookOpen(next).then((isSucceeded) => {
                if (!isSucceeded) {
                    setLocalOpenIds((current) => (current === next ? previousLocal : current))
                }
            })
        },
        [actions, loadNotes, localOpenIds, openIds],
    )

    const collapseAll = useCallback((): void => {
        const previousLocal = localOpenIds
        const next: string[] = []
        setLocalOpenIds(next)
        void actions.setNotebookOpen(next).then((isSucceeded) => {
            if (!isSucceeded) {
                setLocalOpenIds((current) => (current === next ? previousLocal : current))
            }
        })
    }, [actions, localOpenIds])

    const changeSort = useCallback(
        (next: NotebookSort): void => {
            const previousLocal = localSort
            setLocalSort(next)
            void actions.setNotebookSort(next).then((isSucceeded) => {
                if (!isSucceeded) {
                    setLocalSort((current) => (current === next ? previousLocal : current))
                }
            })
        },
        [actions, localSort],
    )

    const isOpen = useCallback((id: string): boolean => openIds.includes(id), [openIds])
    const notesOf = useCallback((id: string): NotebookNotesEntry | null => notes[id] ?? null, [notes])
    const allNotes = useMemo(
        () => (Object.keys(notes).length === 0 ? EMPTY_NOTES : Object.values(notes).flatMap((entry) => entry.items)),
        [notes],
    )

    return { notebooks, sort, openIds, allNotes, isOpen, notesOf, toggleOpen, collapseAll, changeSort }
}
