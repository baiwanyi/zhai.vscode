/**
 * 用户管理数据：关注者列表与标签列表。
 * 复用约定：列表读 wechat/fans/list（宿主只取首屏 100 位并回传总人数），标签读 wechat/fans/tags；
 * 两者互不阻塞——标签失败不影响粉丝列表，反之亦然。
 * 关键约束：不做本地落库与增量合并，每次进入页面都重新拉取，避免显示过期的关注状态；
 * 粉丝列表本身受平台批量资料上限约束，界面的「共 N 位」来自平台 total，不是本地数组长度。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    WechatFanListRequest,
    WechatFanListResult,
    WechatFanSummary,
    WechatFanTag,
    WechatFanTagsRequest,
    WechatFanTagsResult,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

export interface WechatFansState {
    fans: WechatFanSummary[]
    tags: WechatFanTag[]
    /** 平台给出的关注者总数 */
    total: number
    status: 'loading' | 'ready' | 'error'
    error: string | null
    /** 标签单独失败时的说明 */
    tagsError: string | null
    reload: () => Promise<void>
}

export function useWechatFans(accountId: string): WechatFansState {
    const [fans, setFans] = useState<WechatFanSummary[]>([])
    const [tags, setTags] = useState<WechatFanTag[]>([])
    const [total, setTotal] = useState(0)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [tagsError, setTagsError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        const listPayload: WechatFanListRequest = { accountId }
        const tagsPayload: WechatFanTagsRequest = { accountId }
        const [listResult, tagsResult] = await Promise.allSettled([
            request<WechatFanListResult>('wechat/fans/list', listPayload, 60_000),
            request<WechatFanTagsResult>('wechat/fans/tags', tagsPayload, 30_000),
        ])

        if (listResult.status === 'fulfilled') {
            setFans(Array.isArray(listResult.value.fans) ? listResult.value.fans : [])
            setTotal(listResult.value.total)
            setStatus('ready')
            setError(null)
        } else {
            setStatus('error')
            setError(toErrorText(listResult.reason))
        }

        if (tagsResult.status === 'fulfilled') {
            setTags(Array.isArray(tagsResult.value.tags) ? tagsResult.value.tags : [])
            setTagsError(null)
        } else {
            setTags([])
            setTagsError(toErrorText(tagsResult.reason))
        }
    }, [accountId])

    useEffect(() => {
        void reload()
    }, [reload])

    return { fans, tags, total, status, error, tagsError, reload }
}
