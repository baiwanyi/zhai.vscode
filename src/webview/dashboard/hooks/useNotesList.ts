/**
 * 笔记列表视图状态：把宿主下发的最近更新派生成列表项，并维护模块筛选与视图密度。
 * 复用 ../utils 的模块名推断；全部加工在展示层完成，不产生额外宿主请求。
 * 关键约束：筛选选项取自宿主聚合的模块统计，模块名口径须与宿主聚合规则一致。
 */
import { useCallback, useMemo, useReducer } from 'react'
import type { DashboardStats, ModuleStat, NotesViewMode, RecentFile } from '@/shared/types/dashboard'
import { moduleOf } from '../utils'

/** 视图初始值：舒适模式且不施加筛选 */
const INITIAL_VIEW: NotesViewState = { viewMode: 'comfortable', activeModules: [] }

/** 空集合常量：避免每次渲染新建数组导致下游 memo 失效 */
const EMPTY_FILES: RecentFile[] = []
const EMPTY_MODULES: ModuleStat[] = []

interface NotesViewState {
    viewMode: NotesViewMode
    activeModules: string[]
}

type NotesViewAction =
    { type: 'setViewMode'; mode: NotesViewMode } | { type: 'toggleModule'; name: string } | { type: 'resetFilters' }

export interface NotesListState {
    notes: RecentFile[]
    modules: ModuleStat[]
    viewMode: NotesViewMode
    activeModules: string[]
    isFiltered: boolean
    setViewMode: (mode: NotesViewMode) => void
    toggleModule: (name: string) => void
    resetFilters: () => void
}

function notesViewReducer(state: NotesViewState, action: NotesViewAction): NotesViewState {
    switch (action.type) {
        case 'setViewMode':
            return { ...state, viewMode: action.mode }
        case 'toggleModule':
            return {
                ...state,
                activeModules: state.activeModules.includes(action.name)
                    ? state.activeModules.filter((item) => item !== action.name)
                    : [...state.activeModules, action.name],
            }
        case 'resetFilters':
            return { ...state, activeModules: [] }
        default:
            return state
    }
}

export function useNotesList(stats: DashboardStats | null): NotesListState {
    const [view, dispatch] = useReducer(notesViewReducer, INITIAL_VIEW)
    const files = stats?.recentFiles ?? EMPTY_FILES
    const modules = stats?.moduleStats ?? EMPTY_MODULES

    const notes = useMemo(
        () =>
            view.activeModules.length === 0
                ? files
                : files.filter((file) => view.activeModules.includes(moduleOf(file.path))),
        [files, view.activeModules],
    )

    const setViewMode = useCallback((mode: NotesViewMode): void => dispatch({ type: 'setViewMode', mode }), [])
    const toggleModule = useCallback((name: string): void => dispatch({ type: 'toggleModule', name }), [])
    const resetFilters = useCallback((): void => dispatch({ type: 'resetFilters' }), [])

    return {
        notes,
        modules,
        viewMode: view.viewMode,
        activeModules: view.activeModules,
        isFiltered: view.activeModules.length > 0,
        setViewMode,
        toggleModule,
        resetFilters,
    }
}
