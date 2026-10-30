/**
 * 推送批次数据：按账号拉取批次快照，并提供新建/删除批次、增删改文章与从文档导入六个动作。
 * 复用约定：请求走 shared/utils/bridge，错误与提示走 shared/utils/error，批次展示口径取 wechat/utils；
 * 写操作成功后统一重拉批次列表，正文内容只在打开编辑弹窗时按需拉取（wechat/issue/detail）。
 * 关键约束：账号切换由页面重新挂载 hook 承担（accountId 变化即重拉），本层不监听路由；
 * 导入返回 imported: false 表示用户取消选择，静默结束、不弹提示；
 * 写操作进行中置 isMutating，页面据此禁用入口，避免批次内并发写入导致序号错乱。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatArticleCreateRequest,
    WechatArticleCreateResult,
    WechatArticleDetail,
    WechatArticleImportRequest,
    WechatArticleImportResult,
    WechatArticleRemoveRequest,
    WechatArticleUpdateRequest,
    WechatIssueCreateRequest,
    WechatIssueCreateResult,
    WechatIssueDetailRequest,
    WechatIssueDetailResult,
    WechatIssueRemoveRequest,
    WechatIssueSummary,
    WechatIssuesRequest,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import type { WechatListStatus } from '../utils'

/** 新建文章的表单载荷：正文可为空，先占位再补写 */
export interface WechatArticleFormInput {
    issueId: string
    title: string
    author: string
    digest: string
    body: string
}

/** 更新文章的表单载荷 */
export interface WechatArticleUpdateInput extends WechatArticleFormInput {
    id: string
}

export interface WechatIssuesState {
    issues: WechatIssueSummary[]
    status: WechatListStatus
    error: string | null
    isMutating: boolean
    reload: () => Promise<void>
    createIssue: (title?: string) => Promise<WechatIssueSummary | null>
    removeIssue: (id: string) => Promise<boolean>
    createArticle: (input: WechatArticleFormInput) => Promise<WechatArticleDetail | null>
    updateArticle: (input: WechatArticleUpdateInput) => Promise<boolean>
    removeArticle: (id: string) => Promise<boolean>
    importArticle: (issueId: string, sourceKind: 'note' | 'press') => Promise<WechatArticleDetail | null>
    loadArticle: (issueId: string, articleId: string) => Promise<WechatArticleDetail | null>
}

export function useWechatIssues(accountId: string): WechatIssuesState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [status, setStatus] = useState<WechatListStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const payload: WechatIssuesRequest = { accountId }
            const next = await request<WechatIssueSummary[]>('wechat/issues', payload)
            setIssues(Array.isArray(next) ? next : [])
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

    /** 新建批次：成功后重拉并返回批次摘要，页面据此直接进入该批次 */
    const createIssue = useCallback(
        async (title?: string): Promise<WechatIssueSummary | null> => {
            setIsMutating(true)
            const payload: WechatIssueCreateRequest =
                title === undefined || title.length === 0 ? { accountId } : { accountId, title }
            try {
                const created = await request<WechatIssueCreateResult>('wechat/issue/create', payload)
                await reload()
                return created.issue
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsMutating(false)
            }
        },
        [accountId, reload],
    )

    const removeIssue = useCallback(
        async (id: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatIssueRemoveRequest = { id }
            try {
                await request('wechat/issue/remove', payload)
                await reload()
                toast.success('已删除推送批次')
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

    const createArticle = useCallback(
        async (input: WechatArticleFormInput): Promise<WechatArticleDetail | null> => {
            setIsMutating(true)
            const payload: WechatArticleCreateRequest = input
            try {
                const created = await request<WechatArticleCreateResult>('wechat/article/create', payload)
                await reload()
                toast.success('已添加文章')
                return created.article
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    const updateArticle = useCallback(
        async (input: WechatArticleUpdateInput): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatArticleUpdateRequest = {
                id: input.id,
                title: input.title,
                author: input.author,
                digest: input.digest,
                body: input.body,
            }
            try {
                await request('wechat/article/update', payload)
                await reload()
                toast.success('文章已保存')
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

    const removeArticle = useCallback(
        async (id: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatArticleRemoveRequest = { id }
            try {
                await request('wechat/article/remove', payload)
                await reload()
                toast.success('已移除文章')
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

    /** 从笔记/作品导入：取消选择不提示，导入成功提示已加入批次 */
    const importArticle = useCallback(
        async (issueId: string, sourceKind: 'note' | 'press'): Promise<WechatArticleDetail | null> => {
            setIsMutating(true)
            const payload: WechatArticleImportRequest = { issueId, sourceKind }
            try {
                const result = await request<WechatArticleImportResult>('wechat/article/import', payload, 120_000)
                if (!result.imported || result.article === undefined) {
                    return null
                }
                await reload()
                toast.success(`已导入：${result.article.title}`)
                return result.article
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsMutating(false)
            }
        },
        [reload],
    )

    /** 打开编辑弹窗时按需取正文：列表快照不含正文，避免一次把全部文章读进内存 */
    const loadArticle = useCallback(async (issueId: string, articleId: string): Promise<WechatArticleDetail | null> => {
        const payload: WechatIssueDetailRequest = { id: issueId }
        try {
            const detail = await request<WechatIssueDetailResult>('wechat/issue/detail', payload)
            return detail.articles.find((article) => article.id === articleId) ?? null
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    return {
        issues,
        status,
        error,
        isMutating,
        reload,
        createIssue,
        removeIssue,
        createArticle,
        updateArticle,
        removeArticle,
        importArticle,
        loadArticle,
    }
}
