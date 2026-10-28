/**
 * 待办数据装配：清单列表、当前清单与条目的加载，以及新增、勾选、删除三类写操作。
 * 复用约定：请求统一走 @shared/utils/bridge（方法名受 HostMethodName 约束），
 * 错误经 @shared/utils/error 的 toastError 提示，宿主的 todo 通道用于文件被外部改动后刷新。
 * 关键约束：写操作按清单串行（同一时刻只允许一个在途请求），避免快速连点导致行号错位；
 * 乐观更新必须与请求处在同一个串行窗口内——被拒的请求根本不会发出，先改本地就会留下与文件不一致的假状态；
 * 成功后用宿主返回的完整详情覆盖，失败统一重读清单，不做本地猜测回滚；
 * 改名换掉了清单 id，其后的重读同样并入串行窗口，免得与用户的下一次操作抢着落详情；
 * 卸载后到达的响应一律丢弃，不写回已消失的页面。
 */
'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { TodoItem, TodoListDetail, TodoListsSnapshot, TodoListSummary } from '@shared/types/todo'
import { onState, request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 页面阶段：读取中（骨架）、就绪、提交中（禁用开关与提交） */
export type TodoStatus = 'loading' | 'ready' | 'mutating'

export interface TodoUiState {
    lists: TodoListSummary[]
    activeListId: string | null
    items: TodoItem[]
    /** todo 目录绝对路径：空态提示用 */
    dirPath: string
    status: TodoStatus
    /** 当前激活行：删除按钮在该行常显 */
    activeIndex: number | null
}

type TodoAction =
    | { type: 'snapshot'; snapshot: TodoListsSnapshot }
    | { type: 'detail'; detail: TodoListDetail }
    | { type: 'toggle'; index: number; done: boolean }
    | { type: 'remove'; index: number }
    | { type: 'activeIndex'; index: number | null }
    | { type: 'status'; status: TodoStatus }

/** 返回清单详情的写操作方法：只有这类结果才能整体替换当前清单，其余方法混进来会落错结构 */
type TodoDetailMethod = 'todo/item/add' | 'todo/item/delete' | 'todo/item/toggle' | 'todo/list/create'

const INITIAL_STATE: TodoUiState = {
    lists: [],
    activeListId: null,
    items: [],
    dirPath: '',
    status: 'loading',
    activeIndex: null,
}

/**
 * 未完成优先：已完成项沉到末尾，两组内部保持文件顺序（V8 的 sort 为稳定排序）。
 * 关键约束：只改展示顺序，条目的 index 仍是文件中的序号，写操作照旧按 index + text 定位。
 */
function sortPendingFirst(items: readonly TodoItem[]): TodoItem[] {
    return [...items].sort((left, right) => Number(left.done) - Number(right.done))
}

/** 用详情替换当前清单：清单摘要同步进列表，新建清单时追加到末尾 */
function applyDetail(state: TodoUiState, detail: TodoListDetail): TodoUiState {
    const hasList = state.lists.some((list) => list.id === detail.list.id)
    const lists = hasList
        ? state.lists.map((list) => (list.id === detail.list.id ? detail.list : list))
        : [...state.lists, detail.list]
    return {
        ...state,
        lists,
        activeListId: detail.list.id,
        items: sortPendingFirst(detail.items),
        status: 'ready',
        activeIndex: null,
    }
}

function reduceTodo(state: TodoUiState, action: TodoAction): TodoUiState {
    switch (action.type) {
        case 'snapshot':
            return {
                ...state,
                lists: action.snapshot.lists,
                activeListId: action.snapshot.activeListId,
                dirPath: action.snapshot.dirPath,
                items: action.snapshot.activeListId === null ? [] : state.items,
                activeIndex: null,
            }
        case 'detail':
            return applyDetail(state, action.detail)
        case 'toggle':
            return {
                ...state,
                items: sortPendingFirst(
                    state.items.map((item) => (item.index === action.index ? { ...item, done: action.done } : item)),
                ),
            }
        case 'remove':
            return { ...state, items: state.items.filter((item) => item.index !== action.index) }
        case 'activeIndex':
            return { ...state, activeIndex: action.index }
        case 'status':
            return { ...state, status: action.status }
        default:
            return state
    }
}

export interface TodoListsState extends TodoUiState {
    /** 切换清单：宿主读取详情后整体替换 */
    selectList: (listId: string) => Promise<void>
    /** 新建清单并激活 */
    createList: () => Promise<void>
    /** 删除清单（移入回收站） */
    deleteList: (listId: string) => Promise<void>
    /** 重命名当前清单：成功返回 true，弹窗据此关闭 */
    renameList: (name: string) => Promise<boolean>
    /** 新增待办：成功返回 true，页面据此清空输入 */
    addItems: (texts: string[]) => Promise<boolean>
    toggleItem: (item: TodoItem) => void
    deleteItem: (item: TodoItem) => void
    setActiveIndex: (index: number | null) => void
    /** 重新拉取清单与当前详情：外部改动与失败后共用 */
    reload: () => Promise<void>
}

export function useTodoLists(): TodoListsState {
    const [state, dispatch] = useReducer(reduceTodo, INITIAL_STATE)
    const activeIdRef = useRef<string | null>(null)
    const isMutatingRef = useRef(false)
    const isMountedRef = useRef(true)

    useEffect(() => {
        activeIdRef.current = state.activeListId
    }, [state.activeListId])

    /** 读取单个清单详情：失败只提示，不改动当前列表 */
    const loadDetail = useCallback(async (listId: string): Promise<void> => {
        try {
            const detail = await request<TodoListDetail>('todo/items', { listId })
            if (isMountedRef.current) {
                dispatch({ type: 'detail', detail })
            }
        } catch (cause) {
            if (isMountedRef.current) {
                toastError(cause)
                dispatch({ type: 'status', status: 'ready' })
            }
        }
    }, [])

    /**
     * 落快照：激活清单为空时清空条目区并回到就绪，否则按激活清单重读详情。
     * 复用约定：初始加载、外部改动与删除清单三处共用，避免各写一遍「快照 + 可选详情」的流程。
     */
    const applySnapshot = useCallback(
        async (snapshot: TodoListsSnapshot): Promise<void> => {
            if (!isMountedRef.current) {
                return
            }
            dispatch({ type: 'snapshot', snapshot })
            if (snapshot.activeListId === null) {
                dispatch({ type: 'status', status: 'ready' })
                return
            }
            await loadDetail(snapshot.activeListId)
        },
        [loadDetail],
    )

    /** 重新拉取清单快照：清单删空时清空条目区 */
    const reload = useCallback(async (): Promise<void> => {
        try {
            await applySnapshot(await request<TodoListsSnapshot>('todo/lists'))
        } catch (cause) {
            if (isMountedRef.current) {
                toastError(cause)
                dispatch({ type: 'status', status: 'ready' })
            }
        }
    }, [applySnapshot])

    /**
     * 写操作通道：同一时刻只允许一个在途请求，成功后由调用方落详情，失败统一重读。
     * 关键约束：重读放在 catch 里而不是本地回滚——文件可能已被外部改动，以宿主返回为准最可靠；
     * 被拒（已有在途请求）时直接返回 false 且不执行任务，因此乐观更新必须写在任务内部。
     */
    const withMutation = useCallback(
        async (task: () => Promise<void>): Promise<boolean> => {
            if (isMutatingRef.current) {
                return false
            }
            isMutatingRef.current = true
            dispatch({ type: 'status', status: 'mutating' })
            try {
                await task()
                return true
            } catch (cause) {
                toastError(cause)
                await reload()
                return false
            } finally {
                isMutatingRef.current = false
                if (isMountedRef.current) {
                    dispatch({ type: 'status', status: 'ready' })
                }
            }
        },
        [reload],
    )

    /** 把写操作的返回值落成详情：统一处理「响应到达时页面已卸载」的情况 */
    const commitDetail = useCallback(async (method: TodoDetailMethod, payload: unknown): Promise<void> => {
        const detail = await request<TodoListDetail>(method, payload)
        if (isMountedRef.current) {
            dispatch({ type: 'detail', detail })
        }
    }, [])

    // 首屏加载 + 外部改动订阅：文件被编辑器改过时宿主广播 todo 通道，这里按需重读
    useEffect(() => {
        isMountedRef.current = true
        void reload()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'todo' || isMutatingRef.current) {
                return
            }
            void reload()
        })
        return (): void => {
            isMountedRef.current = false
            unsubscribe()
        }
    }, [reload])

    const selectList = useCallback(
        async (listId: string): Promise<void> => {
            if (isMutatingRef.current || listId === activeIdRef.current) {
                return
            }
            dispatch({ type: 'status', status: 'loading' })
            await loadDetail(listId)
        },
        [loadDetail],
    )

    const createList = useCallback(async (): Promise<void> => {
        await withMutation(async () => {
            await commitDetail('todo/list/create', {})
        })
    }, [commitDetail, withMutation])

    const deleteList = useCallback(
        async (listId: string): Promise<void> => {
            await withMutation(async () => {
                await applySnapshot(await request<TodoListsSnapshot>('todo/list/delete', { listId }))
            })
        },
        [applySnapshot, withMutation],
    )

    /**
     * 重命名当前清单：改名会换掉清单 id，无法靠详情覆盖收口，成功后整体重读清单列表。
     * 关键约束：重读留在串行窗口内，否则窗口一关用户就能操作，重读结果可能盖掉更新的一次读取；
     * 失败（重名、非法字符）由 withMutation 统一提示并重读，弹窗据返回值保持打开。
     */
    const renameList = useCallback(
        async (name: string): Promise<boolean> => {
            const listId = activeIdRef.current
            if (listId === null) {
                return false
            }
            return withMutation(async () => {
                await request<TodoListDetail>('todo/list/rename', { listId, name })
                await reload()
            })
        },
        [reload, withMutation],
    )

    const addItems = useCallback(
        async (texts: string[]): Promise<boolean> => {
            const listId = activeIdRef.current
            if (listId === null || texts.length === 0) {
                return false
            }
            return withMutation(async () => {
                await commitDetail('todo/item/add', { listId, texts })
            })
        },
        [commitDetail, withMutation],
    )

    /** 勾选：先在窗口内本地翻转，再由宿主返回的详情校正；被拒时窗口根本不进，不会留下假状态 */
    const toggleItem = useCallback(
        (item: TodoItem): void => {
            const listId = activeIdRef.current
            if (listId === null) {
                return
            }
            const isNextDone = !item.done
            void withMutation(async () => {
                dispatch({ type: 'toggle', index: item.index, done: isNextDone })
                await commitDetail('todo/item/toggle', {
                    listId,
                    index: item.index,
                    text: item.text,
                    done: isNextDone,
                })
            })
        },
        [commitDetail, withMutation],
    )

    /** 删除：同样在窗口内先本地移除，失败时由重读恢复 */
    const deleteItem = useCallback(
        (item: TodoItem): void => {
            const listId = activeIdRef.current
            if (listId === null) {
                return
            }
            void withMutation(async () => {
                dispatch({ type: 'remove', index: item.index })
                await commitDetail('todo/item/delete', { listId, index: item.index, text: item.text })
            })
        },
        [commitDetail, withMutation],
    )

    const setActiveIndex = useCallback((index: number | null): void => {
        dispatch({ type: 'activeIndex', index })
    }, [])

    return {
        ...state,
        selectList,
        createList,
        deleteList,
        renameList,
        addItems,
        toggleItem,
        deleteItem,
        setActiveIndex,
        reload,
    }
}
