/**
 * 用户管理数据：本地快照检索、标签、同步状态与详情。
 * 复用约定：列表优先读 wechat/fans/search，快照为空才回落 wechat/fans/list 的实时首屏；
 * 标签、同步状态与详情分别走独立协议，各自失败互不影响，仅在账号变化时拉取。
 * 关键约束：筛选条件全部交给宿主在本地快照上执行，前端不重复过滤；切换账号由页面 key 重挂载，
 * 本 hook 不缓存跨账号状态；同步是长请求，期间保留旧快照继续展示，不先清空列表；
 * 列表、标签、状态与详情请求分别按序号丢弃迟到响应，避免快速切换筛选或点选时旧数据覆盖新结果；
 * 同步续跑由 hook 按最新任务状态自行决定，调用方只触发动作、不传 taskId。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostMethodName } from '@shared/types/messages'
import type {
    WechatFanDetailRequest,
    WechatFanDetailResult,
    WechatFanListRequest,
    WechatFanListResult,
    WechatFanSearchRequest,
    WechatFanSearchResult,
    WechatFanSummary,
    WechatFanSyncRequest,
    WechatFanSyncResult,
    WechatFanSyncStatusRequest,
    WechatFanSyncStatusResult,
    WechatFanSyncTask,
    WechatFanTag,
    WechatFanTagsRequest,
    WechatFanTagsResult,
    WechatFanStatusFilter,
} from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 一次展示的快照条数：与平台资料批量上限一致 */
const PAGE_SIZE = 100

export interface WechatFansState {
    fans: WechatFanSummary[]
    tags: WechatFanTag[]
    /** 当前筛选命中数 */
    total: number
    /** 本地快照总条数 */
    snapshotTotal: number
    /** 最近一次成功同步时间 */
    syncedAt: string | null
    /** true 表示当前展示的是同步快照，false 表示实时首屏 */
    isSnapshot: boolean
    status: 'loading' | 'ready' | 'error'
    error: string | null
    tagsError: string | null
    syncTask: WechatFanSyncTask | null
    syncError: string | null
    isSyncing: boolean
    keyword: string
    tagId: number | null
    statusFilter: WechatFanStatusFilter
    detail: WechatFanDetailResult | null
    detailError: string | null
    setKeyword: (value: string) => void
    setTagId: (value: number | null) => void
    setStatusFilter: (value: WechatFanStatusFilter) => void
    openDetail: (openid: string) => Promise<void>
    closeDetail: () => void
    reload: () => Promise<void>
    sync: () => Promise<WechatFanSyncResult>
    isMutating: boolean
    actionError: string | null
    clearActionError: () => void
    createTag: (name: string) => Promise<boolean>
    renameTag: (id: number, name: string) => Promise<boolean>
    removeTag: (id: number) => Promise<boolean>
    tagMembers: (openids: string[], tagId: number, action: 'add' | 'remove') => Promise<boolean>
    remark: (openid: string, remark: string) => Promise<boolean>
    blacklist: (openids: string[], action: 'block' | 'unblock') => Promise<boolean>
}

export function useWechatFans(accountId: string): WechatFansState {
    const [fans, setFans] = useState<WechatFanSummary[]>([])
    const [tags, setTags] = useState<WechatFanTag[]>([])
    const [total, setTotal] = useState(0)
    const [snapshotTotal, setSnapshotTotal] = useState(0)
    const [syncedAt, setSyncedAt] = useState<string | null>(null)
    const [isSnapshot, setIsSnapshot] = useState(false)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [tagsError, setTagsError] = useState<string | null>(null)
    const [syncTask, setSyncTask] = useState<WechatFanSyncTask | null>(null)
    // 记录最新任务：续跑决策读 ref，避免 sync 因任务更新而重建闭包
    const syncTaskRef = useRef<WechatFanSyncTask | null>(null)
    const [syncError, setSyncError] = useState<string | null>(null)
    const [isSyncing, setIsSyncing] = useState(false)
    const [keyword, setKeyword] = useState('')
    const [tagId, setTagId] = useState<number | null>(null)
    const [statusFilter, setStatusFilter] = useState<WechatFanStatusFilter>('all')
    const [detail, setDetail] = useState<WechatFanDetailResult | null>(null)
    const [detailError, setDetailError] = useState<string | null>(null)
    // 记录最新点选的 openid：关闭弹窗或改点他人后，迟到响应一律丢弃
    const pendingDetailOpenidRef = useRef<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const fansReloadIdRef = useRef(0)
    const tagsReloadIdRef = useRef(0)
    const statusReloadIdRef = useRef(0)

    useEffect(
        () => (): void => {
            fansReloadIdRef.current += 1
            tagsReloadIdRef.current += 1
            statusReloadIdRef.current += 1
        },
        [],
    )

    const loadTags = useCallback(async (): Promise<void> => {
        const reloadId = ++tagsReloadIdRef.current
        const payload: WechatFanTagsRequest = { accountId }
        try {
            const result = await request<WechatFanTagsResult>(WECHAT_METHODS.tags, payload, 30_000)
            if (reloadId !== tagsReloadIdRef.current) return
            setTags(Array.isArray(result.tags) ? result.tags : [])
            setTagsError(null)
        } catch (cause) {
            if (reloadId !== tagsReloadIdRef.current) return
            setTags([])
            setTagsError(toErrorText(cause))
        }
    }, [accountId])

    const loadSyncStatus = useCallback(async (): Promise<void> => {
        const reloadId = ++statusReloadIdRef.current
        const payload: WechatFanSyncStatusRequest = { accountId }
        try {
            const result = await request<WechatFanSyncStatusResult>(WECHAT_METHODS.fansSyncStatus, payload, 30_000)
            if (reloadId !== statusReloadIdRef.current) return
            setSyncTask(result.task)
            syncTaskRef.current = result.task
        } catch {
            if (reloadId !== statusReloadIdRef.current) return
            setSyncTask(null)
            syncTaskRef.current = null
        }
    }, [accountId])

    const reload = useCallback(async (): Promise<void> => {
        const reloadId = ++fansReloadIdRef.current
        const searchPayload: WechatFanSearchRequest = {
            accountId,
            ...(keyword.trim().length > 0 ? { keyword: keyword.trim() } : {}),
            ...(tagId === null ? {} : { tagId }),
            ...(statusFilter === 'all' || statusFilter === 'blocked'
                ? {}
                : { subscribeStatus: statusFilter === 'subscribed' ? 1 : 0 }),
            ...(statusFilter === 'blocked' ? { isBlocked: true } : {}),
            limit: PAGE_SIZE,
        }
        let searchResult: WechatFanSearchResult | null = null
        try {
            searchResult = await request<WechatFanSearchResult>(WECHAT_METHODS.fansSearch, searchPayload, 60_000)
        } catch {
            // 检索失败时回落实时首屏，与既有口径一致
        }
        if (reloadId !== fansReloadIdRef.current) return

        // 快照有数据就直接展示；无快照或检索失败时回落实时首屏，避免空白页
        if (searchResult !== null && searchResult.snapshotTotal > 0) {
            setFans(searchResult.fans)
            setTotal(searchResult.total)
            setSnapshotTotal(searchResult.snapshotTotal)
            setSyncedAt(searchResult.syncedAt ?? null)
            setIsSnapshot(true)
            setStatus('ready')
            setError(null)
            return
        }

        const listPayload: WechatFanListRequest = { accountId }
        try {
            const live = await request<WechatFanListResult>(WECHAT_METHODS.fansList, listPayload, 60_000)
            if (reloadId !== fansReloadIdRef.current) return
            setFans(Array.isArray(live.fans) ? live.fans : [])
            setTotal(live.total)
            setSnapshotTotal(0)
            setSyncedAt(live.syncedAt ?? null)
            setIsSnapshot(false)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            if (reloadId !== fansReloadIdRef.current) return
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId, keyword, tagId, statusFilter])

    useEffect(() => {
        void reload()
    }, [reload])

    useEffect(() => {
        void loadTags()
        void loadSyncStatus()
    }, [loadTags, loadSyncStatus])

    const sync = useCallback(async (): Promise<WechatFanSyncResult> => {
        setIsSyncing(true)
        setSyncError(null)
        try {
            const latest = syncTaskRef.current
            const taskId = latest === null || latest.status === 'success' ? undefined : latest.id
            const payload: WechatFanSyncRequest = {
                accountId,
                ...(taskId === undefined ? {} : { taskId }),
            }
            const result = await request<WechatFanSyncResult>(WECHAT_METHODS.fansSync, payload, 120_000)
            setSyncTask(result.task)
            syncTaskRef.current = result.task
            await Promise.all([loadTags(), reload()])
            return result
        } catch (cause) {
            setSyncError(toErrorText(cause))
            throw cause
        } finally {
            setIsSyncing(false)
        }
    }, [accountId, loadTags, reload])

    const openDetail = useCallback(
        async (targetOpenid: string): Promise<void> => {
            pendingDetailOpenidRef.current = targetOpenid
            setDetail(null)
            setDetailError(null)
            const payload: WechatFanDetailRequest = { accountId, openid: targetOpenid }
            try {
                const result = await request<WechatFanDetailResult>(WECHAT_METHODS.fansDetail, payload, 30_000)
                if (pendingDetailOpenidRef.current !== targetOpenid) {
                    return
                }
                setDetail(result)
            } catch (cause) {
                if (pendingDetailOpenidRef.current !== targetOpenid) {
                    return
                }
                setDetailError(toErrorText(cause))
            }
        },
        [accountId],
    )

    const closeDetail = useCallback((): void => {
        pendingDetailOpenidRef.current = null
        setDetail(null)
        setDetailError(null)
    }, [])

    /** 所有写操作共用：提交期间禁用界面，成功后回读快照，失败只在本页提示 */
    const runAction = useCallback(
        async (method: HostMethodName, payload: unknown): Promise<boolean> => {
            setIsMutating(true)
            setActionError(null)
            try {
                await request(method, payload, 30_000)
                await Promise.all([loadTags(), reload()])
                return true
            } catch (cause) {
                setActionError(toErrorText(cause))
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [loadTags, reload],
    )

    const createTag = useCallback(
        async (name: string): Promise<boolean> => await runAction(WECHAT_METHODS.tagCreate, { accountId, name }),
        [accountId, runAction],
    )

    const renameTag = useCallback(
        async (id: number, name: string): Promise<boolean> =>
            await runAction(WECHAT_METHODS.tagRename, { accountId, id, name }),
        [accountId, runAction],
    )

    const removeTag = useCallback(
        async (id: number): Promise<boolean> => await runAction(WECHAT_METHODS.tagRemove, { accountId, id }),
        [accountId, runAction],
    )

    const tagMembers = useCallback(
        async (openids: string[], tagId: number, action: 'add' | 'remove'): Promise<boolean> =>
            await runAction(WECHAT_METHODS.tagMembers, { accountId, openids, tagId, action }),
        [accountId, runAction],
    )

    const remark = useCallback(
        async (openid: string, text: string): Promise<boolean> =>
            await runAction(WECHAT_METHODS.fansRemark, { accountId, openid, remark: text }),
        [accountId, runAction],
    )

    const blacklist = useCallback(
        async (openids: string[], action: 'block' | 'unblock'): Promise<boolean> =>
            await runAction(WECHAT_METHODS.fansBlacklist, { accountId, openids, action }),
        [accountId, runAction],
    )

    const clearActionError = useCallback((): void => {
        setActionError(null)
    }, [])

    return {
        fans,
        tags,
        total,
        snapshotTotal,
        syncedAt,
        isSnapshot,
        status,
        error,
        tagsError,
        syncTask,
        syncError,
        isSyncing,
        keyword,
        tagId,
        statusFilter,
        detail,
        detailError,
        setKeyword,
        setTagId,
        setStatusFilter,
        openDetail,
        closeDetail,
        reload,
        sync,
        isMutating,
        actionError,
        clearActionError,
        createTag,
        renameTag,
        removeTag,
        tagMembers,
        remark,
        blacklist,
    }
}
