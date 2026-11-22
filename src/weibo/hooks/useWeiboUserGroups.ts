/**
 * 关注分组取数与写入：读取「该用户所在分组 + 账号全部分组」，并支持新建分组与保存归组。
 * 复用约定：协议走 weibo/user/groups、weibo/user/groupCreate、weibo/user/groupSave，
 * 错误文案走 @shared/utils/error，成功回执由弹窗统一给出。
 * 关键约束：只有弹窗打开（isEnabled）才取数，关闭后不发请求也不保留旧账号的分组；
 * 保存时用「本次读取到的 groupIds」作为 origin 快照，保存成功后再更新快照；
 * 新建成功后本地插入并立即可勾选，不重新拉一次全部分组；
 * 写操作用 ref 单飞，避免连点建出同名分组或重复归组。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type {
    WeiboGroupCreateResult,
    WeiboGroupSaveResult,
    WeiboUserGroup,
    WeiboUserGroupsResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 分组弹窗状态：数据、加载态与两个写操作的进行态 */
export interface UserGroupsState {
    /** 该用户当前所在分组 id：同时作为保存时的 origin 快照 */
    groupIds: string[]
    groups: WeiboUserGroup[]
    isLoading: boolean
    /** 读取失败文案：非空时弹窗给出错误并允许重试 */
    errorMessage: string | null
    isSaving: boolean
    isCreating: boolean
}

type UserGroupsAction =
    | { type: 'reset' }
    | { type: 'load-start' }
    | { type: 'load-success'; result: WeiboUserGroupsResult }
    | { type: 'load-error'; message: string }
    | { type: 'create-start' }
    | { type: 'create-success'; group: WeiboUserGroup }
    | { type: 'create-error'; message: string }
    | { type: 'save-start' }
    | { type: 'save-success'; groupIds: string[] }
    | { type: 'save-error'; message: string }

const INITIAL_STATE: UserGroupsState = {
    groupIds: [],
    groups: [],
    isLoading: false,
    errorMessage: null,
    isSaving: false,
    isCreating: false,
}

function reducer(state: UserGroupsState, action: UserGroupsAction): UserGroupsState {
    switch (action.type) {
        case 'reset':
            return INITIAL_STATE
        case 'load-start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'load-success':
            return {
                ...state,
                groupIds: action.result.groupIds,
                groups: action.result.groups,
                isLoading: false,
                errorMessage: null,
            }
        case 'load-error':
            return { ...state, isLoading: false, errorMessage: action.message }
        case 'create-start':
            return { ...state, isCreating: true, errorMessage: null }
        case 'create-success':
            // 新分组直接进列表（此时还没有成员，计数为 0），弹窗无需再拉一次全部分组
            return { ...state, groups: [...state.groups, action.group], isCreating: false }
        case 'create-error':
            return { ...state, isCreating: false, errorMessage: action.message }
        case 'save-start':
            return { ...state, isSaving: true, errorMessage: null }
        case 'save-success':
            return { ...state, groupIds: action.groupIds, isSaving: false }
        case 'save-error':
            return { ...state, isSaving: false, errorMessage: action.message }
        default:
            return state
    }
}

export interface WeiboUserGroupsController {
    state: UserGroupsState
    /** 重新读取分组：读取失败后的重试入口 */
    reload: () => void
    /** 新建分组：成功返回新分组（已插入本地列表），失败为 null */
    create: (name: string, isPublic: boolean) => Promise<WeiboUserGroup | null>
    /** 保存归组：成功后 groupIds 更新为本次选中的集合 */
    save: (listIds: string[]) => Promise<boolean>
}

/**
 * 分组控制器：uid 变化即重置，弹窗打开时自动取首屏。
 * 关键约束：没有 uid 或未打开时不发请求；在途请求按 uid 归属，切换用户后旧回包丢弃。
 */
export function useWeiboUserGroups(uid: string, isEnabled: boolean): WeiboUserGroupsController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    const stateRef = useRef(state)
    stateRef.current = state
    const uidRef = useRef(uid)
    uidRef.current = uid
    /** 写操作单飞：新建与保存共用，避免连点重复提交 */
    const isWritingRef = useRef(false)

    const load = useCallback(async (): Promise<void> => {
        const currentUid = uidRef.current
        if (currentUid.length === 0) {
            return
        }
        dispatch({ type: 'load-start' })
        try {
            const result = await request<WeiboUserGroupsResult>(WEIBO_METHODS.userGroups, { uid: currentUid })
            if (uidRef.current !== currentUid) {
                return
            }
            dispatch({ type: 'load-success', result })
        } catch (cause) {
            if (uidRef.current !== currentUid) {
                return
            }
            dispatch({ type: 'load-error', message: toErrorText(cause) })
        }
    }, [])

    const reload = useCallback((): void => {
        void load()
    }, [load])

    const create = useCallback(async (name: string, isPublic: boolean): Promise<WeiboUserGroup | null> => {
        const currentUid = uidRef.current
        if (currentUid.length === 0 || isWritingRef.current) {
            return null
        }
        isWritingRef.current = true
        dispatch({ type: 'create-start' })
        try {
            const result = await request<WeiboGroupCreateResult>(WEIBO_METHODS.userGroupCreate, {
                name,
                isPublic,
            })
            if (uidRef.current !== currentUid) {
                return null
            }
            dispatch({ type: 'create-success', group: result.group })
            return result.group
        } catch (cause) {
            if (uidRef.current === currentUid) {
                dispatch({ type: 'create-error', message: toErrorText(cause) })
            }
            return null
        } finally {
            isWritingRef.current = false
        }
    }, [])

    const save = useCallback(async (listIds: string[]): Promise<boolean> => {
        const currentUid = uidRef.current
        if (currentUid.length === 0 || isWritingRef.current) {
            return false
        }
        isWritingRef.current = true
        dispatch({ type: 'save-start' })
        try {
            await request<WeiboGroupSaveResult>(WEIBO_METHODS.userGroupSave, {
                uid: currentUid,
                listIds,
                originListIds: stateRef.current.groupIds,
            })
            if (uidRef.current === currentUid) {
                dispatch({ type: 'save-success', groupIds: listIds })
            }
            return true
        } catch (cause) {
            if (uidRef.current === currentUid) {
                dispatch({ type: 'save-error', message: toErrorText(cause) })
            }
            return false
        } finally {
            isWritingRef.current = false
        }
    }, [])

    useEffect(() => {
        dispatch({ type: 'reset' })
        if (uid.length === 0 || !isEnabled) {
            return
        }
        void load()
    }, [isEnabled, load, uid])

    return { state, reload, create, save }
}
