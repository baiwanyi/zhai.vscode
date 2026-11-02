/**
 * 按 AppID 查本地账号 id：打开批次文档时仪表盘据此跳到该账号的推送列表。
 * 复用约定：账号快照走 wechat/accounts（与账号页、批次页同一份数据），命中只取 id；
 * 请求失败与「查不到账号」一律按 null 处理，由调用方回首页。
 * 关键约束：appId 为 null 时不发请求，返回 undefined 表示「无结论」；
 * 返回值三态——undefined 尚未解析、null 没有匹配账号、string 命中账号，
 * 调用方在 undefined 期间应保持当前页，避免先回首页再跳转造成闪烁。
 */
import { useEffect, useState } from 'react'
import type { WechatAccountsResult } from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'

export function useWechatAccountByAppId(appId: string | null): string | null | undefined {
    const [accountId, setAccountId] = useState<string | null | undefined>(undefined)

    useEffect(() => {
        if (appId === null || appId.length === 0) {
            setAccountId(undefined)
            return
        }
        let isActive = true
        setAccountId(undefined)
        void request<WechatAccountsResult>('wechat/accounts')
            .then((result) => {
                if (!isActive) {
                    return
                }
                setAccountId(result.accounts.find((item) => item.appId === appId)?.id ?? null)
            })
            .catch(() => {
                if (isActive) {
                    setAccountId(null)
                }
            })
        return (): void => {
            isActive = false
        }
    }, [appId])

    return accountId
}
