/**
 * 笔记列表视图状态：把宿主下发的最近更新派生成列表项，并维护模块筛选与多选模式。
 * 复用 ../utils 的模块名推断；全部加工在展示层完成，不产生额外宿主请求。
 * 关键约束：筛选选项取自宿主聚合的模块统计，模块名口径须与宿主聚合规则一致；
 * 退出多选模式时一并清空已选集合，避免残留状态影响下次进入。
 */
import { useCallback, useMemo, useReducer } from 'react'
import type { DashboardStats, ModuleStat, RecentFile } from '@/shared/types/dashboard'
import { moduleOf } from '../utils'

/** 视图初始值：不筛选、非多选、无选中项 */
const INITIAL_VIEW: NotesViewState = { activeModules: [], isSelecting: false, selectedPaths: [] }

/** 空集合常量：避免每次渲染新建数组导致下游 memo 失效 */
const EMPTY_FILES: RecentFile[] = []
const EMPTY_MODULES: ModuleStat[] = []

interface NotesViewState {
    activeModules: string[]
    isSelecting: boolean
    selectedPaths: string[]
}

type NotesViewAction =
    | { type: 'toggleModule'; name: string }
    | { type: 'resetFilters' }
    | { type: 'toggleSelecting' }
    | { type: 'toggleSelected'; path: string }
    | { type: 'clearSelection' }

export interface NotesListState {
    notes: RecentFile[]
    modules: ModuleStat[]
    activeModules: string[]
    isFiltered: boolean
    isSelecting: boolean
    selectedPaths: string[]
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
            return { ...state, activeModules: [] }
        case 'toggleSelecting':
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

    const toggleModule = useCallback((name: string): void => dispatch({ type: 'toggleModule', name }), [])
    const resetFilters = useCallback((): void => dispatch({ type: 'resetFilters' }), [])
    const toggleSelecting = useCallback((): void => dispatch({ type: 'toggleSelecting' }), [])
    const toggleSelected = useCallback((path: string): void => dispatch({ type: 'toggleSelected', path }), [])
    const clearSelection = useCallback((): void => dispatch({ type: 'clearSelection' }), [])

    return {
        notes,
        modules,
        activeModules: view.activeModules,
        isFiltered: view.activeModules.length > 0,
        isSelecting: view.isSelecting,
        selectedPaths: view.selectedPaths,
        toggleModule,
        resetFilters,
        toggleSelecting,
        toggleSelected,
        clearSelection,
    }
}
