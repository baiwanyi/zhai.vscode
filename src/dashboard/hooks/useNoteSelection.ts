/**
 * 笔记多选状态：维护多选开关与选中路径集合，供底部批量操作栏与条目复选圈共用。
 * 复用 useReducer 承载集合增删，避免多次 setState 造成中间态丢失。
 * 关键约束：退出多选时一并清空已选集合，避免残留状态影响下次进入；
 * 「选中项是否已全部置顶」由页面按当前可见笔记的置顶事实计算，本 Hook 不自造置顶状态。
 */
import { useCallback, useMemo, useReducer } from 'react'

interface SelectionState {
    isSelecting: boolean
    selectedPaths: string[]
}

type SelectionAction =
    | { type: 'toggleSelecting' }
    | { type: 'toggleSelected'; path: string }
    | { type: 'clearSelection' }

const INITIAL_STATE: SelectionState = { isSelecting: false, selectedPaths: [] }

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
    switch (action.type) {
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

export interface NoteSelectionState {
    isSelecting: boolean
    selectedPaths: string[]
    /** 选中项是否已全部置顶，供批量置顶按钮决定语义 */
    isAllSelectedPinned: boolean
    toggleSelecting: () => void
    toggleSelected: (path: string) => void
    clearSelection: () => void
}

export function useNoteSelection(pinnedPaths: readonly string[]): NoteSelectionState {
    const [state, dispatch] = useReducer(selectionReducer, INITIAL_STATE)

    const isAllSelectedPinned = useMemo(() => {
        if (state.selectedPaths.length === 0) {
            return false
        }
        const pinned = new Set(pinnedPaths)
        return state.selectedPaths.every((path) => pinned.has(path))
    }, [pinnedPaths, state.selectedPaths])

    const toggleSelecting = useCallback((): void => dispatch({ type: 'toggleSelecting' }), [])
    const toggleSelected = useCallback((path: string): void => dispatch({ type: 'toggleSelected', path }), [])
    const clearSelection = useCallback((): void => dispatch({ type: 'clearSelection' }), [])

    return {
        isSelecting: state.isSelecting,
        selectedPaths: state.selectedPaths,
        isAllSelectedPinned,
        toggleSelecting,
        toggleSelected,
        clearSelection,
    }
}
