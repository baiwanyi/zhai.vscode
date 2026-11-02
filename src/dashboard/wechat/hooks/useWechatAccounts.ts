/**
 * 公众号账号列表数据：拉取账号快照与当前账号，并提供创建、更新、删除、切换与重新鉴权五个动作。
 * 复用约定：请求走 shared/utils/bridge，错误与提示走 shared/utils/error，展示口径取 wechat/utils；
 * 写操作成功后统一重拉，使列表与宿主落库结果一致，不在前端本地拼装状态。
 * 关键约束：写操作进行中置 isMutating 阻止重复提交；重新鉴权单独记 isTestingId，
 * 只禁用被点的那一行，避免整列表在刷新时不可用；创建失败返回 null，由页面决定是否关闭弹窗；
 * 切换账号只写宿主选定并重拉，不改动本地 accounts 顺序。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    CreateWechatAccountRequest,
    CreateWechatAccountResult,
    RemoveWechatAccountRequest,
    SaveWechatAccountCredentialsRequest,
    SaveWechatAccountCredentialsResult,
    SelectWechatAccountRequest,
    SelectWechatAccountResult,
    TestWechatAccountRequest,
    UpdateWechatAccountRequest,
    UpdateWechatAccountResult,
    WechatAccountSummary,
    WechatAccountTestResult,
    WechatAccountType,
    WechatAccountsResult,
} from '@shared/types/wechat'
import { isWechatAccountAuthFailureEvent } from '@shared/types/wechat'
import { onState, request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { WECHAT_STATUS_LABELS, type WechatListStatus } from '../utils'

/** 账号设置表单：名称、类型与默认作者；凭据走单独的保存动作 */
export interface WechatAccountFormInput {
    name: string
    accountType: WechatAccountType
    /** 默认作者：文章设置里作者字段的初始值，空表示不预填 */
    defaultAuthor: string
}

/** 更新账号设置的表单载荷 */
export interface WechatAccountUpdateInput extends WechatAccountFormInput {
    id: string
}

/** 凭据表单：首次配置必须带 AppSecret，之后留空表示沿用已存密钥 */
export interface WechatAccountCredentialsInput {
    id: string
    appId: string
    appSecret: string
}

export interface WechatAccountsState {
    accounts: WechatAccountSummary[]
    /** 当前账号 id：列表的「当前」徽标与账号页入口据此判定 */
    selectedId: string | null
    status: WechatListStatus
    error: string | null
    /** 任一写操作进行中：用于禁用底部入口与弹窗提交 */
    isMutating: boolean
    /** 正在重新鉴权的账号 id：只禁用对应行 */
    isTestingId: string | null
    reload: () => Promise<void>
    createAccount: (input: WechatAccountFormInput) => Promise<WechatAccountSummary | null>
    updateAccount: (input: WechatAccountUpdateInput) => Promise<boolean>
    /** 保存 AppID / AppSecret：成功后由宿主立即鉴权 */
    saveCredentials: (input: WechatAccountCredentialsInput) => Promise<boolean>
    removeAccount: (id: string) => Promise<boolean>
    testAccount: (id: string) => Promise<void>
    selectAccount: (id: string) => Promise<void>
}

export function useWechatAccounts(): WechatAccountsState {
    const [accounts, setAccounts] = useState<WechatAccountSummary[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [status, setStatus] = useState<WechatListStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)
    const [isTestingId, setIsTestingId] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await request<WechatAccountsResult>('wechat/accounts')
            setAccounts(Array.isArray(next.accounts) ? next.accounts : [])
            setSelectedId(next.selectedId)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    /**
     * 鉴权失效：宿主在任意请求内部广播（可能是素材上传或群发触发的，不在本页发起），
     * 这里提示一次并重拉列表，让状态色点立刻反映真实状态，而不是等用户手动刷新。
     */
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'wechat' || !isWechatAccountAuthFailureEvent(message.payload)) {
                return
            }
            const event = message.payload
            toast.error(`「${event.accountName}」鉴权失效：${event.message}`)
            void reload()
        })
    }, [reload])

    /** 创建账号：只提交账号设置，成功后提示去「密钥设置」补凭据 */
    const createAccount = useCallback(
        async (input: WechatAccountFormInput): Promise<WechatAccountSummary | null> => {
            setIsMutating(true)
            const payload: CreateWechatAccountRequest = {
                name: input.name,
                accountType: input.accountType,
                defaultAuthor: input.defaultAuthor,
            }
            try {
                const created = await request<CreateWechatAccountResult>('wechat/account/create', payload)
                await reload()
                toast.success(`已添加公众号：${created.account.name}，请继续在「密钥设置」里填写 AppID 与 AppSecret`)
                return created.account
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    /** 更新账号设置：只改名称、类型与默认作者，凭据走 saveCredentials */
    const updateAccount = useCallback(
        async (input: WechatAccountUpdateInput): Promise<boolean> => {
            setIsMutating(true)
            const payload: UpdateWechatAccountRequest = {
                id: input.id,
                name: input.name,
                accountType: input.accountType,
                defaultAuthor: input.defaultAuthor,
            }
            try {
                await request<UpdateWechatAccountResult>('wechat/account/update', payload)
                await reload()
                toast.success('账号设置已保存')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    /** 保存凭据：宿主写入密钥后立即鉴权，状态与尾号随重拉结果更新 */
    const saveCredentials = useCallback(
        async (input: WechatAccountCredentialsInput): Promise<boolean> => {
            setIsMutating(true)
            const payload: SaveWechatAccountCredentialsRequest = {
                id: input.id,
                appId: input.appId,
                ...(input.appSecret.length > 0 ? { appSecret: input.appSecret } : {}),
            }
            try {
                await request<SaveWechatAccountCredentialsResult>('wechat/account/credentials', payload)
                await reload()
                toast.success('凭据已保存，鉴权结果已更新')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    const removeAccount = useCallback(
        async (id: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: RemoveWechatAccountRequest = { id }
            try {
                await request('wechat/account/remove', payload)
                await reload()
                toast.success('已删除公众号账号')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    /** 重新鉴权：结果按状态文案提示，具体原因由宿主的 hint 带回 */
    const testAccount = useCallback(
        async (id: string): Promise<void> => {
            setIsTestingId(id)
            const payload: TestWechatAccountRequest = { id }
            try {
                const result = await request<WechatAccountTestResult>('wechat/account/test', payload)
                await reload()
                if (result.status === 'connected') {
                    toast.success('连接正常，AccessToken 已刷新')
                } else {
                    toast.warning(result.hint ?? WECHAT_STATUS_LABELS[result.status])
                }
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsTestingId(null)
            }
        },
        [reload],
    )

    /** 切换当前账号：只写宿主选定，列表的「当前」徽标由重拉结果驱动 */
    const selectAccount = useCallback(
        async (id: string): Promise<void> => {
            const payload: SelectWechatAccountRequest = { id }
            try {
                await request<SelectWechatAccountResult>('wechat/account/select', payload)
                await reload()
            } catch (cause) {
                toastError(cause)
            }
        },
        [reload],
    )

    return {
        accounts,
        selectedId,
        status,
        error,
        isMutating,
        isTestingId,
        reload,
        createAccount,
        updateAccount,
        saveCredentials,
        removeAccount,
        testAccount,
        selectAccount,
    }
}
