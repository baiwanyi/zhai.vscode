/**
 * 账号级弹窗编排：账号设置、密钥设置与删除账号的目标状态、表单重挂载 key 与提交动作。
 * 复用约定：宿主动作（updateAccount / saveCredentials / removeAccount）由页面从 useWechatAccounts 注入，
 * 提交成功后由本层关闭弹窗，失败保留让用户就地修正；删除成功后经 onRemoved 交回路由外壳。
 * 关键约束：每次打开都把 key 递增，重挂载弹窗即恢复初始值，避免用 effect 同步表单；
 * 账号设置只改名称/类型/默认作者，凭据走单独的密钥弹窗，两条写入路径不得合并。
 */
import { useCallback, useState } from 'react'
import type {
    WechatAccountCredentialsInput,
    WechatAccountFormInput,
    WechatAccountUpdateInput,
} from './useWechatAccounts'

export interface WechatAccountDialogsDeps {
    accountId: string
    onRemoved: () => void
    updateAccount: (input: WechatAccountUpdateInput) => Promise<boolean>
    saveCredentials: (input: WechatAccountCredentialsInput) => Promise<boolean>
    removeAccount: (id: string) => Promise<boolean>
}

export interface WechatAccountDialogsState {
    edit: {
        isOpen: boolean
        /** 弹窗实例序号：每次打开换 key，重挂载即恢复初始值 */
        key: number
        open: () => void
        setOpen: (open: boolean) => void
        submit: (input: WechatAccountFormInput) => Promise<boolean>
    }
    credentials: {
        isOpen: boolean
        key: number
        open: () => void
        setOpen: (open: boolean) => void
        submit: (input: { appId: string; appSecret: string }) => Promise<boolean>
    }
    remove: {
        isOpen: boolean
        open: () => void
        setOpen: (open: boolean) => void
        confirm: () => void
    }
}

export function useWechatAccountDialogs(deps: WechatAccountDialogsDeps): WechatAccountDialogsState {
    const { accountId, onRemoved, removeAccount, saveCredentials, updateAccount } = deps
    const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false)
    const [accountDialogKey, setAccountDialogKey] = useState(0)
    const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false)
    const [secretDialogKey, setSecretDialogKey] = useState(0)
    const [isAccountRemoveOpen, setIsAccountRemoveOpen] = useState(false)

    const openAccountSettings = useCallback((): void => {
        setAccountDialogKey((previous) => previous + 1)
        setIsAccountDialogOpen(true)
    }, [])

    const openCredentialSettings = useCallback((): void => {
        setSecretDialogKey((previous) => previous + 1)
        setIsSecretDialogOpen(true)
    }, [])

    const submitAccount = useCallback(
        async (input: WechatAccountFormInput): Promise<boolean> => {
            const isSaved = await updateAccount({ ...input, id: accountId })
            if (isSaved) {
                setIsAccountDialogOpen(false)
            }
            return isSaved
        },
        [accountId, updateAccount],
    )

    /** 保存凭据：成功后关闭弹窗；鉴权结果由列表状态与 toast 回显 */
    const submitCredentials = useCallback(
        async (input: { appId: string; appSecret: string }): Promise<boolean> => {
            const isSaved = await saveCredentials({ id: accountId, ...input })
            if (isSaved) {
                setIsSecretDialogOpen(false)
            }
            return isSaved
        },
        [accountId, saveCredentials],
    )

    const confirmRemove = useCallback((): void => {
        setIsAccountRemoveOpen(false)
        void removeAccount(accountId).then((isRemoved) => {
            if (isRemoved) {
                onRemoved()
            }
        })
    }, [accountId, onRemoved, removeAccount])

    return {
        edit: {
            isOpen: isAccountDialogOpen,
            key: accountDialogKey,
            open: openAccountSettings,
            setOpen: setIsAccountDialogOpen,
            submit: submitAccount,
        },
        credentials: {
            isOpen: isSecretDialogOpen,
            key: secretDialogKey,
            open: openCredentialSettings,
            setOpen: setIsSecretDialogOpen,
            submit: submitCredentials,
        },
        remove: {
            isOpen: isAccountRemoveOpen,
            open: () => setIsAccountRemoveOpen(true),
            setOpen: setIsAccountRemoveOpen,
            confirm: confirmRemove,
        },
    }
}
