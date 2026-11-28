/**
 * 推送批次数据：按账号拉取批次快照，并提供新建/删除批次、新建/导入/删除文章与推送等动作。
 * 复用约定：请求走 shared/utils/bridge，错误与提示走 shared/utils/error，批次展示口径取 wechat/utils。
 * 关键约束：账号切换由页面重新挂载 hook 承担（accountId 变化即重拉），本层不监听路由；
 * 重拉只接受最后一次发起的回包，避免写操作与广播触发的并发刷新把新快照覆盖成旧值；
 * 正文不再经本层读写——新建与导入由宿主落成批次文件并打开编辑器，元信息在工作流面板设置；
 * 导入返回 imported: false 表示用户取消选择，静默结束、不弹提示；
 * 封面裁剪分两步：readCoverSource 把选中的图源读成 data URI 供 canvas 使用、
 * saveArticleCover 回传裁剪结果落到批次 images/，原图与结果都不落前端仓库；
 * 写操作进行中置 isMutating，页面据此禁用入口，避免批次内并发写入导致序号错乱。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatArticleCoverRequest,
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
    WechatCoverSourceRequest,
    WechatCoverSourceResult,
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
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { useWechatMutation } from './useWechatMutation'
import { useWechatStateEvent } from './useWechatStateEvent'
import type { WechatListStatus } from '../utils'

/** 文章设置表单：只含发布元信息，标题与封面不在本入口修改 */
export interface WechatArticleMetaInput {
    id: string
    /** 新标题：缺省表示不改标题，本入口不提交它 */
    title?: string
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
    /** 读取封面原图：返回 data URI，供裁剪弹窗在 canvas 里绘制 */
    readCoverSource: (path: string) => Promise<string | null>
    /** 保存裁剪后的封面：宿主落盘到批次 images/ 并回写封面路径 */
    saveArticleCover: (id: string, dataUrl: string) => Promise<boolean>
    removeArticle: (id: string) => Promise<boolean>
    importArticle: (issueId: string, sourceKind: 'note' | 'press') => Promise<WechatArticleDetail | null>
    publishDraft: (issueId: string) => Promise<boolean>
    /** 正式群发：需已有草稿，受账号频率额度约束 */
    publish: (issueId: string) => Promise<boolean>
    /** 查询当前账号的群发额度：确认弹窗据此展示剩余次数 */
    loadQuota: () => Promise<WechatPublishQuotaResult | null>
    /** 打开公众号后台：URL 由宿主固定并在 VS Code 内置浏览器打开，前端只传标识 */
    openBackend: () => Promise<void>
}

export function useWechatIssues(accountId: string): WechatIssuesState {
    const [issues, setIssues] = useState<WechatIssueSummary[]>([])
    const [status, setStatus] = useState<WechatListStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [publishProgress, setPublishProgress] = useState<WechatPublishProgress | null>(null)
    /** 重拉序号：只接受最后一次发起的回包，避免并发刷新的旧结果覆盖新快照 */
    const reloadSeqRef = useRef(0)

    // 订阅推送阶段：只认 wechat 通道且载荷形状正确，其它广播一律忽略
    const handlePublishProgress = useCallback((progress: WechatPublishProgress): void => {
        setPublishProgress(progress)
    }, [])
    useWechatStateEvent(isWechatPublishProgress, handlePublishProgress)

    const reload = useCallback(async (): Promise<void> => {
        const seq = reloadSeqRef.current + 1
        reloadSeqRef.current = seq
        try {
            const payload: WechatIssuesRequest = { accountId }
            const next = await request<WechatIssueSummary[]>(WECHAT_METHODS.issues, payload)
            if (seq !== reloadSeqRef.current) {
                return
            }
            setIssues(Array.isArray(next) ? next : [])
            setStatus('ready')
            setError(null)
        } catch (cause) {
            if (seq !== reloadSeqRef.current) {
                return
            }
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId])

    useEffect(() => {
        void reload()
    }, [reload])

    const { isMutating, run } = useWechatMutation(reload)

    /** 新建批次：成功后重拉并返回批次摘要，页面据此直接进入该批次 */
    const createIssue = useCallback(
        async (title?: string): Promise<WechatIssueSummary | null> => {
            const created = await run({
                execute: () => {
                    const payload: WechatIssueCreateRequest =
                        title === undefined || title.length === 0 ? { accountId } : { accountId, title }
                    return request<WechatIssueCreateResult>(WECHAT_METHODS.issueCreate, payload)
                },
            })
            return created?.issue ?? null
        },
        [accountId, run],
    )

    const removeIssue = useCallback(
        async (id: string): Promise<boolean> => {
            const isRemoved = await run({
                execute: async () => {
                    const payload: WechatIssueRemoveRequest = { id }
                    await request(WECHAT_METHODS.issueRemove, payload)
                    return true
                },
                success: () => '已删除推送批次',
            })
            return isRemoved === true
        },
        [run],
    )

    /** 批量删除：成功提示删除条数，失败时宿主的拒绝原因（哪些批次不可删）直接透出 */
    const removeIssues = useCallback(
        async (ids: string[]): Promise<boolean> => {
            const result = await run({
                execute: () => {
                    const payload: WechatIssuesRemoveBatchRequest = { ids }
                    return request<WechatIssuesRemoveBatchResult>(
                        WECHAT_METHODS.issuesRemoveBatch,
                        payload,
                        60_000,
                    )
                },
                success: (removed) => `已删除 ${String(removed.removed)} 个批次`,
            })
            return result !== undefined
        },
        [run],
    )

    /** 合并批次：成功提示迁移的文章数，失败时宿主的拒绝原因（状态不符 / 超上限）直接透出 */
    const mergeIssues = useCallback(
        async (ids: string[], targetId: string): Promise<boolean> => {
            const result = await run({
                execute: () => {
                    const payload: WechatIssuesMergeRequest = { ids, targetId }
                    return request<WechatIssuesMergeResult>(WECHAT_METHODS.issuesMerge, payload, 60_000)
                },
                success: (merged) => `已把 ${String(merged.movedCount)} 篇文章并入目标批次`,
            })
            return result !== undefined
        },
        [run],
    )

    /** 直接新建一篇：宿主取默认标题、写好批次文件并打开编辑器，本层只负责重拉列表 */
    const quickCreateArticle = useCallback(
        async (issueId: string): Promise<WechatArticleDetail | null> => {
            const created = await run({
                execute: () => {
                    const payload: WechatArticleQuickCreateRequest = { issueId }
                    return request<WechatArticleCreateResult>(WECHAT_METHODS.articleQuickCreate, payload, 120_000)
                },
                success: (result) => `已新建：${result.article.title}`,
            })
            return created?.article ?? null
        },
        [run],
    )

    /** 打开正文文件：旧文章需要先补建文件，超时放宽到 60s */
    const openArticle = useCallback(async (articleId: string): Promise<boolean> => {
        const payload: WechatArticleOpenRequest = { id: articleId }
        try {
            const result = await request<WechatArticleOpenResult>(WECHAT_METHODS.articleOpen, payload, 60_000)
            return result.opened
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [])

    /** 调整顺序：顺序号即推送顺序，移动结果在列表上直接可见，成功不额外弹提示 */
    const moveArticle = useCallback(
        async (id: string, direction: 'up' | 'down'): Promise<boolean> => {
            const isMoved = await run({
                execute: async () => {
                    const payload: WechatArticleMoveRequest = { id, direction }
                    await request(WECHAT_METHODS.articleMove, payload)
                    return true
                },
            })
            return isMoved === true
        },
        [run],
    )

    /** 保存文章元信息：宿主只改库内字段，正文文件保持不动 */
    const updateArticleMeta = useCallback(
        async (input: WechatArticleMetaInput): Promise<boolean> => {
            const isSaved = await run({
                execute: async () => {
                    const payload: WechatArticleMetaRequest = {
                        id: input.id,
                        ...(input.title === undefined ? {} : { title: input.title }),
                        author: input.author,
                        digest: input.digest,
                        allowComment: input.allowComment,
                    }
                    await request(WECHAT_METHODS.articleMeta, payload)
                    return true
                },
                success: () => '文章设置已保存',
            })
            return isSaved === true
        },
        [run],
    )

    /** 读取封面原图：内联成 data URI 才能在 canvas 里裁剪，超大图由宿主拒绝并提示 */
    const readCoverSource = useCallback(async (path: string): Promise<string | null> => {
        const payload: WechatCoverSourceRequest = { path }
        try {
            const result = await request<WechatCoverSourceResult>(WECHAT_METHODS.coverSource, payload, 60_000)
            return result.dataUrl
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    /** 保存裁剪封面：宿主写入批次 images/ 并回写 cover_path，成功后重拉列表刷新卡片 */
    const saveArticleCover = useCallback(
        async (id: string, dataUrl: string): Promise<boolean> => {
            const isSaved = await run({
                execute: async () => {
                    const payload: WechatArticleCoverRequest = { id, dataUrl }
                    await request(WECHAT_METHODS.articleCover, payload, 60_000)
                    return true
                },
                success: () => '封面已更新',
            })
            return isSaved === true
        },
        [run],
    )

    const removeArticle = useCallback(
        async (id: string): Promise<boolean> => {
            const isRemoved = await run({
                execute: async () => {
                    const payload: WechatArticleRemoveRequest = { id }
                    await request(WECHAT_METHODS.articleRemove, payload)
                    return true
                },
                success: () => '已删除文章及其批次文档',
            })
            return isRemoved === true
        },
        [run],
    )

    /** 从笔记/作品导入：取消选择不提示，导入成功提示已加入批次 */
    const importArticle = useCallback(
        async (issueId: string, sourceKind: 'note' | 'press'): Promise<WechatArticleDetail | null> => {
            const result = await run({
                execute: () => {
                    const payload: WechatArticleImportRequest = { issueId, sourceKind }
                    return request<WechatArticleImportResult>(WECHAT_METHODS.articleImport, payload, 120_000)
                },
                shouldReload: (imported) => imported.imported,
                success: (imported) => (imported.article === undefined ? null : `已导入：${imported.article.title}`),
            })
            return result?.imported === true ? result.article ?? null : null
        },
        [run],
    )

    /**
     * 生成草稿：渲染与补传素材在宿主完成，可能耗时数十秒，故单独放宽超时。
     * 关键约束：非阻断提示（外链图片、文件缺失）用 warning 展示，成功结论不受影响。
     */
    const publishDraft = useCallback(
        async (issueId: string): Promise<boolean> => {
            const result = await run({
                execute: () => {
                    const payload: WechatPublishDraftRequest = { issueId }
                    return request<WechatPublishDraftResult>(WECHAT_METHODS.issuePublishDraft, payload, 180_000)
                },
                onSettled: () => {
                    // 阶段提示只服务于本次动作，结束即清空，避免残留在界面上
                    setPublishProgress(null)
                },
            })
            if (result === undefined) {
                return false
            }
            toast.success('草稿已生成，可到公众号后台预览或群发')
            const [first] = result.warnings
            if (first !== undefined) {
                const extra =
                    result.warnings.length > 1 ? `（另有 ${String(result.warnings.length - 1)} 项提示）` : ''
                toast.warning(`${first}${extra}`)
            }
            return true
        },
        [run],
    )

    /**
     * 正式群发：不可撤销，故超时放宽到 180s（含宿主的发布结果轮询）。
     * 关键约束：返回的批次仍可能是 pushing——平台异步发布未出结果，界面按「处理中」展示，不臆断成功。
     */
    const publish = useCallback(
        async (issueId: string): Promise<boolean> => {
            const result = await run({
                execute: () => {
                    const payload: WechatPublishRequest = { issueId }
                    return request<WechatPublishResult>(WECHAT_METHODS.issuePublish, payload, 180_000)
                },
                // 失败时也要重拉：宿主已把失败原因写进批次，列表需要展示出来
                onFailed: reload,
                onSettled: () => setPublishProgress(null),
            })
            if (result === undefined) {
                return false
            }
            if (result.issue.status === 'published') {
                toast.success('群发已完成，可到公众号后台查看文章')
            } else {
                toast.info('已提交群发，平台仍在处理，稍后可在公众号后台确认')
            }
            return true
        },
        [reload, run],
    )

    /** 查询群发额度：确认弹窗打开时拉取，失败只提示不影响继续操作 */
    const loadQuota = useCallback(async (): Promise<WechatPublishQuotaResult | null> => {
        const payload: WechatPublishQuotaRequest = { accountId }
        try {
            return await request<WechatPublishQuotaResult>(WECHAT_METHODS.publishQuota, payload)
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [accountId])

    /** 打开公众号后台：前端只传固定标识，地址由宿主解析并在 VS Code 内置浏览器打开 */
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
        readCoverSource,
        saveArticleCover,
        removeArticle,
        importArticle,
        publishDraft,
        publish,
        loadQuota,
        openBackend,
    }
}
