/**
 * 公众号当前账号：工作流六个运营分区的共同作用域。
 * 复用约定：直接读 wechat/accounts 的 selectedId（宿主在仪表盘进入账号页或选模块时写入），
 * 前端不另存一份账号选择，避免两处状态不一致。
 * 关键约束：未选账号或账号已被删除时返回 null，由各分区渲染引导空态而不是空数据页；
 * 六个分区共用本 hook 的一次结果，不各自请求，避免同一份快照在多个页面各存一份。
 */
import { useCallback, useEffect, useState } from 'react'
import type { WechatAccountSummary, WechatAccountsResult } from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 账号读取状态：ready 表示已拿到快照（account 可能为 null，表示未选） */
export type WechatScopeStatus = 'loading' | 'ready' | 'error'

export interface WechatAccountScopeState {
    account: WechatAccountSummary | null
    status: WechatScopeStatus
    error: string | null
    reload: () => Promise<void>
}

export function useWechatAccountScope(): WechatAccountScopeState {
    const [account, setAccount] = useState<WechatAccountSummary | null>(null)
    const [status, setStatus] = useState<WechatScopeStatus>('loading')
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const result = await request<WechatAccountsResult>('wechat/accounts')
            const selected =
                result.selectedId === null
                    ? null
                    : (result.accounts.find((item) => item.id === result.selectedId) ?? null)
            setAccount(selected)
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

    return { account, status, error, reload }
}
