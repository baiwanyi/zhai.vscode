/**
 * 留言数据：已推送批次 → 文章 → 留言列表，以及回复、加精、删除三个写操作。
 * 复用约定：批次读 wechat/issues，留言读 wechat/comment/list（网络抖动重试一次），写操作走 comment/{reply,mark,remove}。
 * 关键约束：默认选中首个已推送批次的首篇；草稿态无群发标识不可选；
 * 写后按已加载范围重拉并去重，重拉失败保留成功结果但明确提示；
 * 各请求按序号丢弃迟到响应，续载用同步锁防双入口并发；
 * 写操作的忙状态按留言 id 标记，避免一条留言的提交禁用整页；
 * 已加载列表与总数镜像到 ref 以稳定回调链。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatCommentArticleRequest,
    WechatCommentArticleResult,
    WechatCommentListRequest,
    WechatCommentListResult,
    WechatCommentMarkRequest,
    WechatCommentRemoveRequest,
    WechatCommentReplyRequest,
    WechatCommentSummary,
    WechatIssueSummary,
    WechatIssuesRequest,
} from '@shared/types/wechat'
import { WECHAT_COMMENT_PAGE_SIZE } from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

/** 写后重拉的最大页数：多拉一页的收益递减，超过这个量宁可保留截断也不让一次点击连发多请求 */
const REFRESH_MAX_PAGES = 3

/** 列表读取的重试间隔：只对只读请求重试一次，写操作不做自动重试以免重复副作用 */
const LIST_RETRY_DELAY_MS = 300

/** 合并两页留言并按 id 去重：总数变化时 offset 可能错位，重复项会让 React key 冲突 */
function mergeComments(current: WechatCommentSummary[], incoming: WechatCommentSummary[]): WechatCommentSummary[] {
    const seen = new Set(current.map((comment) => comment.id))
    return [...current, ...incoming.filter((comment) => !seen.has(comment.id))]
}

/** 只有已推送且有文章的批次才有留言可查：useMemo 与 loadIssues 共用，避免两处口径漂移 */
function selectViewableIssues(issues: WechatIssueSummary[]): WechatIssueSummary[] {
    return issues.filter((issue) => issue.status === 'published' && issue.articles.length > 0)
}

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
    /** 正在写操作的留言 id：null 表示没有或无法定位到具体条目 */
    mutatingCommentId: number | null
    /** 是否正在追加下一页：只标续载，首屏与写操作后的重拉不计入 */
    isLoadingMore: boolean
    selectIssue: (issueId: string) => void
    selectArticle: (sortIndex: number) => void
    reload: () => Promise<void>
    loadMore: () => Promise<void>
    reply: (commentId: number, content: string) => Promise<boolean>
    mark: (commentId: number, elected: boolean) => Promise<boolean>
    remove: (commentId: number) => Promise<boolean>
    /** 打开当前文章的原文：链路由宿主从库中取并校验域名，前端不持有地址 */
    openArticle: () => Promise<boolean>
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
    const [mutatingCommentId, setMutatingCommentId] = useState<number | null>(null)
    const [isLoadingMore, setIsLoadingMore] = useState(false)

    // 请求序号：切换批次/文章与写后重拉会让在途响应失效，避免旧数据覆盖新视图
    const commentsReloadIdRef = useRef(0)
    const issuesReloadIdRef = useRef(0)
    // 已加载列表与总数的镜像：让 refreshLoaded / loadMore 不随分页状态重建
    const commentsRef = useRef<WechatCommentSummary[]>([])
    const totalRef = useRef(0)
    // 同步锁：哨兵与手动按钮是两条入口，state 更新滞后会放行两次并发续载
    const isLoadingMoreRef = useRef(false)

    /** 只有已推送且有文章的批次才有留言可查 */
    const issues = useMemo(() => selectViewableIssues(allIssues), [allIssues])

    // 卸载时让在途请求全部失效，避免组件销毁后仍写入状态
    useEffect(
        () => (): void => {
            commentsReloadIdRef.current += 1
            issuesReloadIdRef.current += 1
        },
        [],
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

    /** 单页请求：不落状态，由 loadComments（首屏/续载）与 refreshLoaded（写后重拉）各自决定如何合并 */
    const fetchPage = useCallback(
        async (offset: number): Promise<WechatCommentListResult> => {
            if (selectedIssueId === null) {
                return { comments: [], total: 0 }
            }
            const payload: WechatCommentListRequest = {
                accountId,
                issueId: selectedIssueId,
                sortIndex: selectedSortIndex,
                offset,
            }
            const send = (): Promise<WechatCommentListResult> =>
                request<WechatCommentListResult>(WECHAT_METHODS.commentList, payload, 60_000)
            try {
                return await send()
            } catch {
                // 只读请求对网络抖动重试一次；写操作不在这里重试，避免重复副作用
                await new Promise<void>((resolve) => setTimeout(resolve, LIST_RETRY_DELAY_MS))
                return send()
            }
        },
        [accountId, selectedIssueId, selectedSortIndex],
    )

    const loadComments = useCallback(
        async (offset: number): Promise<void> => {
            if (selectedIssueId === null) {
                commentsRef.current = []
                totalRef.current = 0
                setComments([])
                setTotal(0)
                setStatus('ready')
                return
            }
            const reloadId = ++commentsReloadIdRef.current
            try {
                const result = await fetchPage(offset)
                if (reloadId !== commentsReloadIdRef.current) {
                    return
                }
                const merged = offset === 0 ? result.comments : mergeComments(commentsRef.current, result.comments)
                commentsRef.current = merged
                totalRef.current = result.total
                setComments(merged)
                setTotal(result.total)
                setStatus('ready')
                setError(null)
            } catch (cause) {
                if (reloadId !== commentsReloadIdRef.current) {
                    return
                }
                setStatus('error')
                setError(toErrorText(cause))
            }
        },
        [fetchPage, selectedIssueId],
    )

    /**
     * 写操作后的重拉：覆盖当前已加载范围，避免回复一次就整页跳回第一条。
     * 关键约束：最多连续拉 REFRESH_MAX_PAGES 页，超出部分宁可截断也不无限续拉；
     * 返回刷新是否成功，写操作成功但刷新失败时由调用方给出「请手动刷新」提示，
     * 不把已经成功的写操作改写成失败；每页返回后都校验序号，切换文章时立即丢弃剩余页。
     */
    const refreshLoaded = useCallback(async (): Promise<boolean> => {
        if (selectedIssueId === null) {
            return true
        }
        const reloadId = ++commentsReloadIdRef.current
        const pageCount = Math.min(
            REFRESH_MAX_PAGES,
            Math.max(1, Math.ceil(Math.max(commentsRef.current.length, 1) / WECHAT_COMMENT_PAGE_SIZE)),
        )
        try {
            let merged: WechatCommentSummary[] = []
            let latestTotal = totalRef.current
            for (let page = 0; page < pageCount; page += 1) {
                const result = await fetchPage(merged.length)
                if (reloadId !== commentsReloadIdRef.current) {
                    return true
                }
                merged = mergeComments(merged, result.comments)
                latestTotal = result.total
                if (result.comments.length === 0) {
                    break
                }
            }
            commentsRef.current = merged
            totalRef.current = latestTotal
            setComments(merged)
            setTotal(latestTotal)
            setStatus('ready')
            setError(null)
            return true
        } catch (cause) {
            if (reloadId !== commentsReloadIdRef.current) {
                return true
            }
            setStatus('error')
            setError(toErrorText(cause))
            return false
        }
    }, [fetchPage, selectedIssueId])

    /** 只拉批次列表：与留言分开，避免切换文章时重复请求批次 */
    const loadIssues = useCallback(async (): Promise<void> => {
        const reloadId = ++issuesReloadIdRef.current
        const payload: WechatIssuesRequest = { accountId }
        try {
            const next = await request<WechatIssueSummary[]>(WECHAT_METHODS.issues, payload)
            if (reloadId !== issuesReloadIdRef.current) {
                return
            }
            const nextIssues = Array.isArray(next) ? next : []
            setAllIssues(nextIssues)
            // 没有可查看批次时选中 effect 与留言 effect 都会提前返回，loadComments 永不执行；
            // 必须在这里收尾 loading 并清空旧选中态，否则骨架屏永久不退、旧数据也会残留。
            if (selectViewableIssues(nextIssues).length === 0) {
                commentsRef.current = []
                totalRef.current = 0
                setComments([])
                setTotal(0)
                setSelectedIssueId(null)
                setSelectedSortIndex(1)
                setStatus('ready')
                setError(null)
            }
        } catch (cause) {
            if (reloadId !== issuesReloadIdRef.current) {
                return
            }
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
        if (isLoadingMoreRef.current || commentsRef.current.length >= totalRef.current) {
            return
        }
        isLoadingMoreRef.current = true
        setIsLoadingMore(true)
        try {
            await loadComments(commentsRef.current.length)
        } finally {
            isLoadingMoreRef.current = false
            setIsLoadingMore(false)
        }
    }, [loadComments])

    /** 写操作的公共骨架：校验选中项、按条置忙、调用、按已加载范围刷新并反馈刷新结果 */
    const runWrite = useCallback(
        async (action: () => Promise<unknown>, successText: string, commentId: number | null): Promise<boolean> => {
            if (selectedIssueId === null) {
                return false
            }
            setIsMutating(true)
            setMutatingCommentId(commentId)
            let isSucceeded = false
            try {
                await action()
                isSucceeded = true
                const isRefreshed = await refreshLoaded()
                toast.success(isRefreshed ? successText : `${successText}，但列表刷新失败，请手动刷新`)
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsMutating(false)
                setMutatingCommentId(null)
            }
            return isSucceeded
        },
        [refreshLoaded, selectedIssueId],
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
            return runWrite(() => request(WECHAT_METHODS.commentReply, payload, 30_000), '回复成功', commentId)
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
                () => request(WECHAT_METHODS.commentMark, payload, 30_000),
                elected ? '已设为精选' : '已取消精选',
                commentId,
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
            return runWrite(() => request(WECHAT_METHODS.commentRemove, payload, 30_000), '留言已删除', commentId)
        },
        [accountId, runWrite, selectedIssueId, selectedSortIndex],
    )

    /**
     * 打开原文：只传账号与批次，地址由宿主取库并校验域名后在 VS Code 内置浏览器打开。
     * 关键约束：失败用 toast 提示而不是改写列表状态——打开链接失败与留言数据无关。
     */
    const openArticle = useCallback(async (): Promise<boolean> => {
        if (selectedIssueId === null) {
            return false
        }
        const payload: WechatCommentArticleRequest = { accountId, issueId: selectedIssueId }
        try {
            await request<WechatCommentArticleResult>(WECHAT_METHODS.commentArticle, payload)
            return true
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [accountId, selectedIssueId])

    return {
        issues,
        selectedIssueId,
        selectedSortIndex,
        comments,
        total,
        status,
        error,
        isMutating,
        mutatingCommentId,
        isLoadingMore,
        selectIssue,
        selectArticle,
        reload,
        loadMore,
        reply,
        mark,
        remove,
        openArticle,
    }
}
