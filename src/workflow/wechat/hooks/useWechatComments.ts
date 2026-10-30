/**
 * 留言数据：已推送批次 → 文章 → 留言列表，以及回复、加精、删除三个写操作。
 * 复用约定：批次读 wechat/issues（只保留已推送且有文章的批次，未群发的批次没有留言定位标识），
 * 留言读 wechat/comment/list，写操作分别走 comment/reply、comment/mark、comment/remove。
 * 关键约束：默认选中第一个可用批次的第一篇文章，避免进页面先看到一片空白；
 * 只有已推送的批次可选——草稿态没有群发消息标识，选它只会拿到宿主的拒绝提示；
 * 写操作成功后重拉当前页，不做本地乐观更新，避免与平台状态不一致。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatCommentListRequest,
    WechatCommentListResult,
    WechatCommentMarkRequest,
    WechatCommentRemoveRequest,
    WechatCommentReplyRequest,
    WechatCommentSummary,
    WechatIssueSummary,
    WechatIssuesRequest,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

export interface WechatCommentsState {
    /** 可作为留言筛选对象的批次：仅已推送且有文章 */
    issues: WechatIssueSummary[]
    selectedIssueId: string | null
    selectedSortIndex: number
    comments: WechatCommentSummary[]
    total: number
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isMutating: boolean
    selectIssue: (issueId: string) => void
    selectArticle: (sortIndex: number) => void
    reload: () => Promise<void>
    loadMore: () => Promise<void>
    reply: (commentId: number, content: string) => Promise<boolean>
    mark: (commentId: number, elected: boolean) => Promise<boolean>
    remove: (commentId: number) => Promise<boolean>
}

export function useWechatComments(accountId: string): WechatCommentsState {
    const [allIssues, setAllIssues] = useState<WechatIssueSummary[]>([])
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
    const [selectedSortIndex, setSelectedSortIndex] = useState(1)
    const [comments, setComments] = useState<WechatCommentSummary[]>([])
    const [total, setTotal] = useState(0)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)

    /** 只有已推送且有文章的批次才有留言可查 */
    const issues = useMemo(
        () => allIssues.filter((issue) => issue.status === 'published' && issue.articles.length > 0),
        [allIssues],
    )

    // 首次拿到批次后补默认选中，避免进页面就是空列表
    useEffect(() => {
        if (selectedIssueId !== null || issues.length === 0) {
            return
        }
        const [first] = issues
        if (first !== undefined) {
            setSelectedIssueId(first.id)
            setSelectedSortIndex(first.articles[0]?.sortIndex ?? 1)
        }
    }, [issues, selectedIssueId])

    const loadComments = useCallback(
        async (offset: number): Promise<void> => {
            if (selectedIssueId === null) {
                setComments([])
                setTotal(0)
                setStatus('ready')
                return
            }
            const payload: WechatCommentListRequest = {
                accountId,
                issueId: selectedIssueId,
                sortIndex: selectedSortIndex,
                offset,
            }
            try {
                const result = await request<WechatCommentListResult>('wechat/comment/list', payload, 60_000)
                setComments((previous) => (offset === 0 ? result.comments : [...previous, ...result.comments]))
                setTotal(result.total)
                setStatus('ready')
                setError(null)
            } catch (cause) {
                setStatus('error')
                setError(toErrorText(cause))
            }
        },
        [accountId, selectedIssueId, selectedSortIndex],
    )

    /** 只拉批次列表：与留言分开，避免切换文章时重复请求批次 */
    const loadIssues = useCallback(async (): Promise<void> => {
        const payload: WechatIssuesRequest = { accountId }
        try {
            const next = await request<WechatIssueSummary[]>('wechat/issues', payload)
            setAllIssues(Array.isArray(next) ? next : [])
        } catch (cause) {
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId])

    // 进入页面或账号切换时拉批次
    useEffect(() => {
        void loadIssues()
    }, [loadIssues])

    // 选中批次或文章变化时重载首页留言
    useEffect(() => {
        if (selectedIssueId === null) {
            return
        }
        void loadComments(0)
    }, [loadComments, selectedIssueId])

    const reload = useCallback(async (): Promise<void> => {
        setStatus('loading')
        await loadIssues()
        await loadComments(0)
    }, [loadComments, loadIssues])

    const selectIssue = useCallback(
        (issueId: string): void => {
            setSelectedIssueId(issueId)
            const issue = issues.find((item) => item.id === issueId)
            setSelectedSortIndex(issue?.articles[0]?.sortIndex ?? 1)
        },
        [issues],
    )

    const selectArticle = useCallback((sortIndex: number): void => {
        setSelectedSortIndex(sortIndex)
    }, [])

    const loadMore = useCallback(async (): Promise<void> => {
        if (comments.length >= total) {
            return
        }
        await loadComments(comments.length)
    }, [comments.length, loadComments, total])

    /** 写操作的公共骨架：校验选中项、置忙、调用、刷新 */
    const runWrite = useCallback(
        async (action: () => Promise<unknown>, successText: string): Promise<boolean> => {
            if (selectedIssueId === null) {
                return false
            }
            setIsMutating(true)
            try {
                await action()
                await loadComments(0)
                toast.success(successText)
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [loadComments, selectedIssueId],
    )

    const reply = useCallback(
        async (commentId: number, content: string): Promise<boolean> => {
            if (selectedIssueId === null) {
                return false
            }
            const payload: WechatCommentReplyRequest = {
                accountId,
                issueId: selectedIssueId,
                sortIndex: selectedSortIndex,
                commentId,
                content,
            }
            return runWrite(() => request('wechat/comment/reply', payload, 30_000), '回复成功')
        },
        [accountId, runWrite, selectedIssueId, selectedSortIndex],
    )

    const mark = useCallback(
        async (commentId: number, elected: boolean): Promise<boolean> => {
            if (selectedIssueId === null) {
                return false
            }
            const payload: WechatCommentMarkRequest = {
                accountId,
                issueId: selectedIssueId,
                sortIndex: selectedSortIndex,
                commentId,
                elected,
            }
            return runWrite(
                () => request('wechat/comment/mark', payload, 30_000),
                elected ? '已设为精选' : '已取消精选',
            )
        },
        [accountId, runWrite, selectedIssueId, selectedSortIndex],
    )

    const remove = useCallback(
        async (commentId: number): Promise<boolean> => {
            if (selectedIssueId === null) {
                return false
            }
            const payload: WechatCommentRemoveRequest = {
                accountId,
                issueId: selectedIssueId,
                sortIndex: selectedSortIndex,
                commentId,
            }
            return runWrite(() => request('wechat/comment/remove', payload, 30_000), '留言已删除')
        },
        [accountId, runWrite, selectedIssueId, selectedSortIndex],
    )

    return {
        issues,
        selectedIssueId,
        selectedSortIndex,
        comments,
        total,
        status,
        error,
        isMutating,
        selectIssue,
        selectArticle,
        reload,
        loadMore,
        reply,
        mark,
        remove,
    }
}
