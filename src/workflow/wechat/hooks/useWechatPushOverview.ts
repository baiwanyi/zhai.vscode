/**
 * 推送管理数据：当前账号的批次快照、群发额度与文章元信息写入。
 * 复用约定：批次读 wechat/issues（与仪表盘批次页同一份数据），额度读 wechat/publishQuota，
 * 文章元信息写 wechat/article/meta，封面选择走 wechat/cover/pick；错误提示与展示口径交给页面。
 * 关键约束：额度与批次必须同时可用——只拿到批次而额度失败时仍渲染列表，
 * 额度区单独显示失败原因，不因一个次要数据源失败把整页变成错误页；
 * 正文不在这里读写：保存元信息时宿主保留文件里的正文，本层只提交发布相关字段。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { isWechatPublishProgress } from '@shared/types/wechat'
import type {
    WechatArticleMetaRequest,
    WechatCoverPickResult,
    WechatIssueSummary,
    WechatIssuesRequest,
    WechatPublishProgress,
    WechatPublishQuotaRequest,
    WechatPublishQuotaResult,
} from '@shared/types/wechat'
import { onState, request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

/** 文章元信息表单：正文由编辑器维护，这里只提交发布相关字段 */
export interface WechatArticleMetaInput {
    id: string
    title: string
    author: string
    digest: string
    coverPath: string
    allowComment: boolean
}

export interface WechatPushOverviewState {
    issues: WechatIssueSummary[]
    /** 进行中的推送任务：切回本页时仍能看到「现在在跑什么」 */
    tasks: WechatPublishProgress[]
    quota: WechatPublishQuotaResult | null
    status: 'loading' | 'ready' | 'error'
    error: string | null
    /** 额度单独失败时的说明：有值时额度区显示该文案而不显示数字 */
    quotaError: string | null
    reload: () => Promise<void>
    /** 保存文章元信息：成功后重拉批次，正文文件由宿主原样保留 */
    saveArticleMeta: (input: WechatArticleMetaInput) => Promise<boolean>
    /** 选择封面图：返回存储根相对路径，取消返回 null */
    pickCover: () => Promise<string | null>
}

export function useWechatPushOverview(accountId: string): WechatPushOverviewState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [tasks, setTasks] = useState<WechatPublishProgress[]>([])

    // 即时进度：宿主播报阶段时按批次覆盖，结束时由下一次查询清理
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'wechat' || !isWechatPublishProgress(message.payload)) {
                return
            }
            const progress = message.payload
            setTasks((previous) => [...previous.filter((item) => item.issueId !== progress.issueId), progress])
        })
    }, [])
    const [quota, setQuota] = useState<WechatPublishQuotaResult | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [quotaError, setQuotaError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        const issuesPayload: WechatIssuesRequest = { accountId }
        const quotaPayload: WechatPublishQuotaRequest = { accountId }
        const [issuesResult, quotaResult, tasksResult] = await Promise.allSettled([
            request<WechatIssueSummary[]>('wechat/issues', issuesPayload),
            request<WechatPublishQuotaResult>('wechat/publishQuota', quotaPayload),
            request<WechatPublishProgress[]>('wechat/tasks'),
        ])

        // 任务查询是权威口径：以它为准覆盖即时订阅累积的结果，避免已完成的任务残留
        setTasks(tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value) ? tasksResult.value : [])

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

    /** 保存文章元信息：全文以宿主重写的 frontmatter 为准，成功后重拉批次让卡片显示新标题 */
    const saveArticleMeta = useCallback(
        async (input: WechatArticleMetaInput): Promise<boolean> => {
            const payload: WechatArticleMetaRequest = {
                id: input.id,
                title: input.title,
                author: input.author,
                digest: input.digest,
                coverPath: input.coverPath,
                allowComment: input.allowComment,
            }
            try {
                await request('wechat/article/meta', payload)
                await reload()
                toast.success('文章设置已保存')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            }
        },
        [reload],
    )

    /** 选择封面：用户在系统对话框里停留的时间不可控，超时放宽到 60s */
    const pickCover = useCallback(async (): Promise<string | null> => {
        try {
            const result = await request<WechatCoverPickResult>('wechat/cover/pick', undefined, 60_000)
            return result.path
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    return { issues, tasks, quota, status, error, quotaError, reload, saveArticleMeta, pickCover }
}
