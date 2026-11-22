/**
 * 屏蔽名单：读取当前生效的用户名与关键字名单，整份保存，并把单个博主追加进用户名名单。
 * 复用约定：协议走 weibo/blockList/status 与 weibo/blockList/save，名单归一化与匹配复用
 * @shared/utils/weiboBlock，页面只消费状态与动作，不自行拼请求参数。
 * 关键约束：与 Cookie 无关，未配置凭证也能维护名单；挂载即读取一次，保存成功后用回包替换本地状态，
 * 过滤在取数 hook 里按这份状态即时生效；两个名单一次落盘，避免半份名单生效；
 * 整份保存的成功提示交给调用方（设置弹窗统一给一条），「屏蔽该博主」自己给更具体的反馈。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type { WeiboBlockListState, WeiboBlockRules } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { addWeiboBlockedUser } from '@shared/utils/weiboBlock'

interface BlockListState extends WeiboBlockListState {
    isLoading: boolean
    isSaving: boolean
    errorMessage: string | null
}

type BlockListAction =
    | { type: 'start' }
    | { type: 'success'; payload: WeiboBlockListState }
    | { type: 'failure'; message: string }
    | { type: 'saving'; value: boolean }

const INITIAL_STATE: BlockListState = {
    blockedUsers: [],
    blockedKeywords: [],
    isLoading: true,
    isSaving: false,
    errorMessage: null,
}

function reducer(state: BlockListState, action: BlockListAction): BlockListState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return {
                blockedUsers: action.payload.blockedUsers,
                blockedKeywords: action.payload.blockedKeywords,
                isLoading: false,
                isSaving: false,
                errorMessage: null,
            }
        case 'failure':
            return { ...state, isLoading: false, isSaving: false, errorMessage: action.message }
        case 'saving':
            return { ...state, isSaving: action.value }
        default:
            return state
    }
}

export interface WeiboBlockListController {
    state: BlockListState
    /** 保存整份名单：返回是否成功，失败时设置弹窗保留输入 */
    save: (rules: WeiboBlockRules) => Promise<boolean>
    /** 屏蔽单个博主：已在名单里时只提示，不重复写盘；成功后当前信息流即时过滤掉该博主 */
    blockUser: (name: string) => Promise<boolean>
}

/** 屏蔽名单控制器：挂载读取一次，保存与追加都以宿主回包为准更新本地状态 */
export function useWeiboBlockList(): WeiboBlockListController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 追加动作要读最新名单，但不该因名单变化重建回调：用 ref 承载一份同步副本
    const stateRef = useRef(state)
    stateRef.current = state
    /** 写盘单飞：连点「屏蔽该博主」时第二次直接丢弃，避免同一份名单重复提交与两条回执 */
    const isWritingRef = useRef(false)

    useEffect(() => {
        const load = async (): Promise<void> => {
            dispatch({ type: 'start' })
            try {
                const result = await request<WeiboBlockListState>(WEIBO_METHODS.blockListStatus)
                dispatch({ type: 'success', payload: result })
            } catch (cause) {
                dispatch({ type: 'failure', message: toErrorText(cause) })
            }
        }
        void load()
    }, [])

    const persist = useCallback(async (next: WeiboBlockRules): Promise<boolean> => {
        if (isWritingRef.current) {
            return false
        }
        isWritingRef.current = true
        dispatch({ type: 'saving', value: true })
        try {
            const result = await request<WeiboBlockListState>(WEIBO_METHODS.blockListSave, next)
            dispatch({ type: 'success', payload: result })
            return true
        } catch (cause) {
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
            return false
        } finally {
            isWritingRef.current = false
        }
    }, [])

    const blockUser = useCallback(
        async (name: string): Promise<boolean> => {
            const current = stateRef.current
            const next = addWeiboBlockedUser(
                { blockedUsers: current.blockedUsers, blockedKeywords: current.blockedKeywords },
                name,
            )
            // 已在名单里：无需写盘，但仍给出反馈，避免用户以为点击没生效
            if (next === current) {
                toast(`该博主已在屏蔽名单里：${name}`)
                return true
            }
            const isSaved = await persist(next)
            if (isSaved) {
                toast.success(`已屏蔽 ${name}：该博主的内容不再出现在信息流里`)
            }
            return isSaved
        },
        [persist],
    )

    // 保存不在这里提示：设置弹窗一次提交多项，成功文案由它统一给出，避免连弹多条
    return { state, save: persist, blockUser }
}
