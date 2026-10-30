/**
 * 推送管理数据：当前账号的批次快照与群发额度。
 * 复用约定：批次读 wechat/issues（与仪表盘批次页同一份数据），额度读 wechat/publishQuota，
 * 两者都按账号收窄；错误提示与展示口径交给页面，本层只做取数与状态。
 * 关键约束：额度与批次必须同时可用——只拿到批次而额度失败时仍渲染列表，
 * 额度区单独显示失败原因，不因一个次要数据源失败把整页变成错误页。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    WechatIssueSummary,
    WechatIssuesRequest,
    WechatPublishQuotaRequest,
    WechatPublishQuotaResult,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

export interface WechatPushOverviewState {
    issues: WechatIssueSummary[]
    quota: WechatPublishQuotaResult | null
    status: 'loading' | 'ready' | 'error'
    error: string | null
    /** 额度单独失败时的说明：有值时额度区显示该文案而不显示数字 */
    quotaError: string | null
    reload: () => Promise<void>
}

export function useWechatPushOverview(accountId: string): WechatPushOverviewState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [quota, setQuota] = useState<WechatPublishQuotaResult | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [quotaError, setQuotaError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        const issuesPayload: WechatIssuesRequest = { accountId }
        const quotaPayload: WechatPublishQuotaRequest = { accountId }
        const [issuesResult, quotaResult] = await Promise.allSettled([
            request<WechatIssueSummary[]>('wechat/issues', issuesPayload),
            request<WechatPublishQuotaResult>('wechat/publishQuota', quotaPayload),
        ])

        if (issuesResult.status === 'fulfilled') {
            setIssues(Array.isArray(issuesResult.value) ? issuesResult.value : [])
            setStatus('ready')
            setError(null)
        } else {
            setStatus('error')
            setError(toErrorText(issuesResult.reason))
        }

        if (quotaResult.status === 'fulfilled') {
            setQuota(quotaResult.value)
            setQuotaError(null)
        } else {
            setQuota(null)
            setQuotaError(toErrorText(quotaResult.reason))
        }
    }, [accountId])

    useEffect(() => {
        void reload()
    }, [reload])

    return { issues, quota, status, error, quotaError, reload }
}
