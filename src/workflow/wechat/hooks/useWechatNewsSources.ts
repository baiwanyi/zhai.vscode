/**
 * 图文素材数据：当前账号已发布且拿到 articleId 的批次，作为菜单「图文」内容的选择来源。
 * 复用约定：列表读 wechat/issues（与推送管理共用一份数据），错误文案由本层收窄、展示交给调用方；
 * 关键约束：只读，不触发任何平台写操作；只有发布完成且带 articleId 的批次才能被菜单下发，
 * 草稿或未取到 articleId 的批次会被过滤，避免出现选了却点不动的菜单。
 */
import { useCallback, useEffect, useState } from 'react'
import type { WechatIssueSummary, WechatIssuesRequest } from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

export interface WechatNewsSourcesState {
    issues: WechatIssueSummary[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    reload: () => Promise<void>
}

export function useWechatNewsSources(accountId: string): WechatNewsSourcesState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        const payload: WechatIssuesRequest = { accountId }
        try {
            const result = await request<WechatIssueSummary[]>(WECHAT_METHODS.issues, payload)
            const usable = Array.isArray(result)
                ? result.filter(
                      (issue) => issue.articleCount > 0 && issue.status === 'published' && issue.articleId !== undefined,
                  )
                : []
            setIssues(usable)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId])

    useEffect(() => {
        void reload()
    }, [reload])

    return { issues, status, error, reload }
}
