/**
 * 推送批次数据：按账号拉取批次快照，并提供新建/删除批次、新建/导入/删除文章与推送等动作。
 * 复用约定：请求走 shared/utils/bridge，错误与提示走 shared/utils/error，批次展示口径取 wechat/utils。
 * 关键约束：账号切换由页面重新挂载 hook 承担（accountId 变化即重拉），本层不监听路由；
 * 正文不再经本层读写——新建与导入由宿主落成批次文件并打开编辑器，元信息在工作流面板设置；
 * 导入返回 imported: false 表示用户取消选择，静默结束、不弹提示；
 * 写操作进行中置 isMutating，页面据此禁用入口，避免批次内并发写入导致序号错乱。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatArticleCreateResult,
    WechatArticleDetail,
    WechatArticleImportRequest,
    WechatArticleImportResult,
    WechatArticleMetaRequest,
    WechatArticleMoveRequest,
    WechatArticleOpenRequest,
    WechatArticleOpenResult,
    WechatArticleQuickCreateRequest,
    WechatArticleRemoveRequest,
    WechatIssueCreateRequest,
    WechatIssueCreateResult,
    WechatIssueRemoveRequest,
    WechatIssueSummary,
    WechatIssuesMergeRequest,
    WechatIssuesMergeResult,
    WechatIssuesRemoveBatchRequest,
    WechatIssuesRemoveBatchResult,
    WechatIssuesRequest,
    WechatPublishDraftRequest,
    WechatPublishDraftResult,
    WechatPublishProgress,
    WechatPublishQuotaRequest,
    WechatPublishQuotaResult,
    WechatPublishRequest,
    WechatPublishResult,
} from '@shared/types/wechat'
import { isWechatPublishProgress } from '@shared/types/wechat'
import { onState, request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import type { WechatListStatus } from '../utils'

/** 文章设置表单：只含发布元信息，标题与封面不在本入口修改 */
export interface WechatArticleMetaInput {
    id: string
    /** 原样回传：契约要求标题必填，本入口不改它 */
    title: string
    author: string
    digest: string
    allowComment: boolean
}

export interface WechatIssuesState {
    issues: WechatIssueSummary[]
    status: WechatListStatus
    error: string | null
    isMutating: boolean
    /** 当前推送阶段：宿主播报，动作结束后清空 */
    publishProgress: WechatPublishProgress | null
    reload: () => Promise<void>
    createIssue: (title?: string) => Promise<WechatIssueSummary | null>
    removeIssue: (id: string) => Promise<boolean>
    /** 批量删除：只允许草稿与失败批次，宿主会整体校验 */
    removeIssues: (ids: string[]) => Promise<boolean>
    /** 合并批次：把所选批次的文章并入目标批次，源批次被删除 */
    mergeIssues: (ids: string[], targetId: string) => Promise<boolean>
    /** 直接新建一篇：宿主取默认标题、落好文件并打开编辑器 */
    quickCreateArticle: (issueId: string) => Promise<WechatArticleDetail | null>
    /** 在编辑器里打开正文文件（旧文章缺文件时宿主会先补建） */
    openArticle: (articleId: string) => Promise<boolean>
    /** 上移 / 下移一篇：顺序号即公众号的推送顺序 */
    moveArticle: (id: string, direction: 'up' | 'down') => Promise<boolean>
    /** 保存发布元信息：作者、摘要与留言开关，标题与封面原样回传 */
    updateArticleMeta: (input: WechatArticleMetaInput) => Promise<boolean>
    removeArticle: (id: string) => Promise<boolean>
    importArticle: (issueId: string, sourceKind: 'note' | 'press') => Promise<WechatArticleDetail | null>
    publishDraft: (issueId: string) => Promise<boolean>
    /** 正式群发：需已有草稿，受账号频率额度约束 */
    publish: (issueId: string) => Promise<boolean>
    /** 查询当前账号的群发额度：确认弹窗据此展示剩余次数 */
    loadQuota: () => Promise<WechatPublishQuotaResult | null>
    /** 打开公众号后台：URL 由宿主固定，前端只传标识 */
    openBackend: () => Promise<void>
}

export function useWechatIssues(accountId: string): WechatIssuesState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [status, setStatus] = useState<WechatListStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)
    const [publishProgress, setPublishProgress] = useState<WechatPublishProgress | null>(null)

    // 订阅推送阶段：只认 wechat 通道且载荷形状正确，其它广播一律忽略
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'wechat' || !isWechatPublishProgress(message.payload)) {
                return
            }
            setPublishProgress(message.payload)
        })
    }, [])

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

    /** 批量删除：成功提示删除条数，失败时宿主的拒绝原因（哪些批次不可删）直接透出 */
    const removeIssues = useCallback(
        async (ids: string[]): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatIssuesRemoveBatchRequest = { ids }
            try {
                const result = await request<WechatIssuesRemoveBatchResult>(
                    'wechat/issues/removeBatch',
                    payload,
                    60_000,
                )
                await reload()
                toast.success(`已删除 ${String(result.removed)} 个批次`)
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

    /** 合并批次：成功提示迁移的文章数，失败时宿主的拒绝原因（状态不符 / 超上限）直接透出 */
    const mergeIssues = useCallback(
        async (ids: string[], targetId: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatIssuesMergeRequest = { ids, targetId }
            try {
                const result = await request<WechatIssuesMergeResult>('wechat/issues/merge', payload, 60_000)
                await reload()
                toast.success(`已把 ${String(result.movedCount)} 篇文章并入目标批次`)
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

    /** 直接新建一篇：宿主取默认标题、写好批次文件并打开编辑器，本层只负责重拉列表 */
    const quickCreateArticle = useCallback(
        async (issueId: string): Promise<WechatArticleDetail | null> => {
            setIsMutating(true)
            const payload: WechatArticleQuickCreateRequest = { issueId }
            try {
                const created = await request<WechatArticleCreateResult>('wechat/article/quickCreate', payload, 120_000)
                await reload()
                toast.success(`已新建：${created.article.title}`)
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

    /** 打开正文文件：旧文章需要先补建文件，超时放宽到 60s */
    const openArticle = useCallback(async (articleId: string): Promise<boolean> => {
        const payload: WechatArticleOpenRequest = { id: articleId }
        try {
            const result = await request<WechatArticleOpenResult>('wechat/article/open', payload, 60_000)
            return result.opened
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [])

    /** 调整顺序：顺序号即推送顺序，移动结果在列表上直接可见，成功不额外弹提示 */
    const moveArticle = useCallback(
        async (id: string, direction: 'up' | 'down'): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatArticleMoveRequest = { id, direction }
            try {
                await request('wechat/article/move', payload)
                await reload()
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

    /** 保存文章元信息：宿主重写 frontmatter 之外的库内字段，正文文件保持不动 */
    const updateArticleMeta = useCallback(
        async (input: WechatArticleMetaInput): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatArticleMetaRequest = {
                id: input.id,
                title: input.title,
                author: input.author,
                digest: input.digest,
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
                toast.success('已删除文章及其批次文档')
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

    /**
     * 生成草稿：渲染与补传素材在宿主完成，可能耗时数十秒，故单独放宽超时。
     * 关键约束：非阻断提示（外链图片、文件缺失）用 warning 展示，成功结论不受影响。
     */
    const publishDraft = useCallback(
        async (issueId: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatPublishDraftRequest = { issueId }
            try {
                const result = await request<WechatPublishDraftResult>('wechat/issue/publishDraft', payload, 180_000)
                await reload()
                toast.success('草稿已生成，可到公众号后台预览或群发')
                const [first] = result.warnings
                if (first !== undefined) {
                    const extra =
                        result.warnings.length > 1 ? `（另有 ${String(result.warnings.length - 1)} 项提示）` : ''
                    toast.warning(`${first}${extra}`)
                }
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsMutating(false)
                // 阶段提示只服务于本次动作，结束即清空，避免残留在界面上
                setPublishProgress(null)
            }
        },
        [reload],
    )

    /**
     * 正式群发：不可撤销，故超时放宽到 180s（含宿主的发布结果轮询）。
     * 关键约束：返回的批次仍可能是 pushing——平台异步发布未出结果，界面按「处理中」展示，不臆断成功。
     */
    const publish = useCallback(
        async (issueId: string): Promise<boolean> => {
            setIsMutating(true)
            const payload: WechatPublishRequest = { issueId }
            try {
                const result = await request<WechatPublishResult>('wechat/issue/publish', payload, 180_000)
                await reload()
                if (result.issue.status === 'published') {
                    toast.success('群发已完成，可到公众号后台查看文章')
                } else {
                    toast.info('已提交群发，平台仍在处理，稍后可在公众号后台确认')
                }
                return true
            } catch (cause) {
                toastError(cause)
                // 失败时也要重拉：宿主已把失败原因写进批次，列表需要展示出来
                await reload()
                return false
            } finally {
                setIsMutating(false)
                setPublishProgress(null)
            }
        },
        [reload],
    )

    /** 查询群发额度：确认弹窗打开时拉取，失败只提示不影响继续操作 */
    const loadQuota = useCallback(async (): Promise<WechatPublishQuotaResult | null> => {
        const payload: WechatPublishQuotaRequest = { accountId }
        try {
            return await request<WechatPublishQuotaResult>('wechat/publishQuota', payload)
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [accountId])

    /** 打开公众号后台：前端只传固定标识，地址由宿主解析 */
    const openBackend = useCallback(async (): Promise<void> => {
        try {
            await request('host/openExternal', 'wechatMp')
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return {
        issues,
        status,
        error,
        isMutating,
        publishProgress,
        reload,
        createIssue,
        removeIssue,
        removeIssues,
        mergeIssues,
        quickCreateArticle,
        openArticle,
        moveArticle,
        updateArticleMeta,
        removeArticle,
        importArticle,
        publishDraft,
        publish,
        loadQuota,
        openBackend,
    }
}
