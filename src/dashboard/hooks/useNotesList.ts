/**
 * 笔记列表视图状态：把宿主下发的最近更新拆成置顶分组与其余列表，并维护模块筛选、关键词搜索与多选模式。
 * 复用 ../utils 的模块名推断；全部加工在展示层完成，不产生额外宿主请求。
 * 关键约束：筛选选项取自宿主聚合的模块统计，模块名口径须与宿主聚合规则一致；
 * 置顶分组直接取宿主下发的 isPinned，展示层不自行排序；
 * 退出多选模式时一并清空已选集合，避免残留状态影响下次进入；
 * 搜索框常驻页面头部，本 Hook 只持有关键词（无展开态）：进入多选保留关键词以免丢失过滤条件；
 * 关键词匹配标题与路径且不区分大小写，清除筛选时连同关键词一并复位。
 */
import { useCallback, useMemo, useReducer } from 'react'
import type { DashboardStats, ModuleStat, RecentFile } from '@shared/types/dashboard'
import { moduleOf } from '../utils'

/** 视图初始值：不筛选、无关键词、非多选、无选中项 */
const INITIAL_VIEW: NotesViewState = {
    activeModules: [],
    query: '',
    isSelecting: false,
    selectedPaths: [],
}

/** 空集合常量：避免每次渲染新建数组导致下游 memo 失效 */
const EMPTY_FILES: RecentFile[] = []
const EMPTY_MODULES: ModuleStat[] = []

interface NotesViewState {
    activeModules: string[]
    query: string
    isSelecting: boolean
    selectedPaths: string[]
}

type NotesViewAction =
    | { type: 'toggleModule'; name: string }
    | { type: 'resetFilters' }
    | { type: 'toggleSelecting' }
    | { type: 'toggleSelected'; path: string }
    | { type: 'clearSelection' }
    | { type: 'clearQuery' }
    | { type: 'changeQuery'; query: string }

/** 搜索框的可控句柄：常驻页面头部，输入层只负责上抛变更与清空 */
export interface NotesSearchState {
    /** 当前关键词，参与列表过滤 */
    query: string
    changeQuery: (value: string) => void
    /** 清空关键词，列表回到未搜索状态 */
    clear: () => void
}

export interface NotesListState {
    /** 置顶分组，顺序由宿主排定 */
    pinnedNotes: RecentFile[]
    /** 置顶之外的笔记，保持宿主下发的 mtime 倒序 */
    unpinnedNotes: RecentFile[]
    modules: ModuleStat[]
    activeModules: string[]
    /** 模块筛选或关键词任一存在即为筛选中，供空态决定是否给出清除入口 */
    isFiltered: boolean
    /** 搜索入口：展开态与关键词由本 Hook 统一持有 */
    search: NotesSearchState
    isSelecting: boolean
    selectedPaths: string[]
    /** 选中项是否已全部置顶，供底部操作栏决定按钮语义 */
    isAllSelectedPinned: boolean
    toggleModule: (name: string) => void
    resetFilters: () => void
    toggleSelecting: () => void
    toggleSelected: (path: string) => void
    clearSelection: () => void
}

function notesViewReducer(state: NotesViewState, action: NotesViewAction): NotesViewState {
    switch (action.type) {
        case 'toggleModule':
            return {
                ...state,
                activeModules: state.activeModules.includes(action.name)
                    ? state.activeModules.filter((item) => item !== action.name)
                    : [...state.activeModules, action.name],
            }
        case 'resetFilters':
            return { ...state, activeModules: [], query: '' }
        case 'toggleSelecting':
            // 关键词不随多选开关复位：多选期间的列表仍按同一份过滤结果展示
            return state.isSelecting
                ? { ...state, isSelecting: false, selectedPaths: [] }
                : { ...state, isSelecting: true }
        case 'toggleSelected':
            return {
                ...state,
                selectedPaths: state.selectedPaths.includes(action.path)
                    ? state.selectedPaths.filter((item) => item !== action.path)
                    : [...state.selectedPaths, action.path],
            }
        case 'clearSelection':
            return { ...state, selectedPaths: [] }
        case 'clearQuery':
            return { ...state, query: '' }
        case 'changeQuery':
            return { ...state, query: action.query }
        default:
            return state
    }
}

export function useNotesList(stats: DashboardStats | null): NotesListState {
    const [view, dispatch] = useReducer(notesViewReducer, INITIAL_VIEW)
    const files = stats?.recentFiles ?? EMPTY_FILES
    const modules = stats?.moduleStats ?? EMPTY_MODULES

    const keyword = view.query.trim().toLowerCase()
    const visibleNotes = useMemo(
        () =>
            files.filter((file) => {
                if (view.activeModules.length > 0 && !view.activeModules.includes(moduleOf(file.path))) {
                    return false
                }
                if (keyword === '') {
                    return true
                }
                return file.title.toLowerCase().includes(keyword) || file.path.toLowerCase().includes(keyword)
            }),
        [files, view.activeModules, keyword],
    )

    const pinnedNotes = useMemo(() => visibleNotes.filter((file) => file.isPinned), [visibleNotes])
    const unpinnedNotes = useMemo(() => visibleNotes.filter((file) => !file.isPinned), [visibleNotes])
    const isAllSelectedPinned = useMemo(() => {
        const selected = visibleNotes.filter((file) => view.selectedPaths.includes(file.path))
        return selected.length > 0 && selected.every((file) => file.isPinned)
    }, [visibleNotes, view.selectedPaths])

    const toggleModule = useCallback((name: string): void => dispatch({ type: 'toggleModule', name }), [])
    const resetFilters = useCallback((): void => dispatch({ type: 'resetFilters' }), [])
    const toggleSelecting = useCallback((): void => dispatch({ type: 'toggleSelecting' }), [])
    const toggleSelected = useCallback((path: string): void => dispatch({ type: 'toggleSelected', path }), [])
    const clearSelection = useCallback((): void => dispatch({ type: 'clearSelection' }), [])
    const clearQuery = useCallback((): void => dispatch({ type: 'clearQuery' }), [])
    const changeQuery = useCallback((value: string): void => dispatch({ type: 'changeQuery', query: value }), [])

    const search = useMemo<NotesSearchState>(
        () => ({
            query: view.query,
            changeQuery,
            clear: clearQuery,
        }),
        [view.query, changeQuery, clearQuery],
    )

    return {
        pinnedNotes,
        unpinnedNotes,
        modules,
        activeModules: view.activeModules,
        isFiltered: view.activeModules.length > 0 || keyword !== '',
        search,
        isSelecting: view.isSelecting,
        selectedPaths: view.selectedPaths,
        isAllSelectedPinned,
        toggleModule,
        resetFilters,
        toggleSelecting,
        toggleSelected,
        clearSelection,
    }
}
