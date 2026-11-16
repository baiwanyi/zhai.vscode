/**
 * 笔记本视图状态：把宿主下发的笔记本快照整理成可渲染的分组列表，并维护展开集合、排序与组内笔记缓存。
 * 复用 @shared/utils/bridge 按需读取组内笔记，排序口径与宿主 notebookService 保持一致（置顶优先、再按偏好方式）。
 * 关键约束：展开与排序先在本地生效再落库，落库失败回滚到操作前的值，避免界面与偏好长期分叉；
 * 组内笔记只在展开时读取，宿主快照变化后重新拉取已展开的组，使删除、恢复与改名后的列表立即收敛；
 * 首次进入且宿主没有记录任何展开项时自动展开默认笔记本，纯本地行为，不写回偏好，用户点「全部收起」后不再自动展开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardStats, RecentFile } from '@shared/types/dashboard'
import type { ListNotebookNotesResult, NotebookSort, NotebookSummary } from '@shared/types/notebook'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { NotebookNotesEntry } from '../note/types'

/** 空集合常量：避免每次渲染新建数组导致下游 memo 失效 */
const EMPTY_IDS: string[] = []
const EMPTY_NOTES: RecentFile[] = []

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
    openIds: string[]
    /** 已加载的组内笔记（含未展开的历史缓存），供页面反查标题 */
    allNotes: RecentFile[]
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
    const openIdsRef = useRef<string[]>(EMPTY_IDS)

    const sort = localSort ?? stats?.notebookPrefs.sort ?? DEFAULT_SORT
    const openIds = localOpenIds ?? stats?.notebookPrefs.openIds ?? EMPTY_IDS
    openIdsRef.current = openIds

    const notebooks = useMemo(() => {
        const list = stats?.notebooks ?? []
        const pinnedIds = list.filter((notebook) => notebook.isPinned).map((notebook) => notebook.id)
        return sortNotebooks(list, sort, pinnedIds)
    }, [sort, stats])

    const loadNotes = useCallback(async (id: string): Promise<void> => {
        setNotes((previous) => ({
            ...previous,
            [id]: { status: 'loading', items: previous[id]?.items ?? [], error: null },
        }))
        try {
            const result = await request<ListNotebookNotesResult>('notebook/notes', { id })
            setNotes((previous) => ({ ...previous, [id]: { status: 'ready', items: result.items, error: null } }))
        } catch (cause) {
            setNotes((previous) => ({
                ...previous,
                [id]: { status: 'error', items: [], error: toErrorText(cause) },
            }))
        }
    }, [])

    // 宿主快照变化（增删改、外部编辑）后重新拉取已展开的组，保证组内笔记不落后于磁盘
    useEffect(() => {
        for (const id of openIdsRef.current) {
            void loadNotes(id)
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

    const toggleOpen = useCallback(
        (id: string): void => {
            const previous = openIds
            const isOpen = previous.includes(id)
            const next = isOpen ? previous.filter((item) => item !== id) : [...previous, id]
            setLocalOpenIds(next)
            if (!isOpen) {
                void loadNotes(id)
            }
            void actions.setNotebookOpen(next).then((isSucceeded) => {
                if (!isSucceeded) {
                    setLocalOpenIds(previous)
                }
            })
        },
        [actions, loadNotes, openIds],
    )

    const collapseAll = useCallback((): void => {
        const previous = openIds
        setLocalOpenIds([])
        void actions.setNotebookOpen([]).then((isSucceeded) => {
            if (!isSucceeded) {
                setLocalOpenIds(previous)
            }
        })
    }, [actions, openIds])

    const changeSort = useCallback(
        (next: NotebookSort): void => {
            const previous = sort
            setLocalSort(next)
            void actions.setNotebookSort(next).then((isSucceeded) => {
                if (!isSucceeded) {
                    setLocalSort(previous)
                }
            })
        },
        [actions, sort],
    )

    const isOpen = useCallback((id: string): boolean => openIds.includes(id), [openIds])
    const notesOf = useCallback((id: string): NotebookNotesEntry | null => notes[id] ?? null, [notes])
    const allNotes = useMemo(
        () => (Object.keys(notes).length === 0 ? EMPTY_NOTES : Object.values(notes).flatMap((entry) => entry.items)),
        [notes],
    )

    return { notebooks, sort, openIds, allNotes, isOpen, notesOf, toggleOpen, collapseAll, changeSort }
}
