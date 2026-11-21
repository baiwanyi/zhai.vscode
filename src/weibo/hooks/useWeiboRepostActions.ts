/**
 * 转发写操作：附言草稿、模式切换、提交与删除确认，全部收在这里。
 * 复用约定：协议方法名取 @shared/types/weiboMethods，字数上限取 @shared/types/weibo，
 * 错误提示取 @shared/utils/error；成功后统一走调用方注入的 reload 重拉，并通过 onCommitted 调整总数。
 * 关键约束：写操作用 ref 单飞，避开同一帧连点读到旧 state；
 * 附言上限随模式切换（纯转发 500 字 / 同时评论 140 字），切换不截断已有文字，按钮与提交各挡一次。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WEIBO_COMMENT_MAX_LENGTH, WEIBO_REPOST_MAX_LENGTH } from '@shared/types/weibo'
import type { WeiboDestroyStatusResult, WeiboRepostCreateResult, WeiboRepostItem } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { KeyboardEvent } from 'react'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 请求超时：展开列表与提交转发都是主动等待的场景，与评论同口径 */
const REQUEST_TIMEOUT_MS = 20_000

export interface UseWeiboRepostActionsOptions {
    /** 微博数字 id */
    postId: string
    /** 写成功后重拉第一页：由取数 Hook 提供 */
    reload: () => Promise<void>
    /** 写成功后的总数变化：由取数 Hook 的 adjustCount 提供（发布 +1、删除 -1） */
    onCommitted: (delta: 1 | -1) => void
}

export interface WeiboRepostActions {
    draft: string
    shouldComment: boolean
    /** 当前模式下的字数上限：纯转发按转发上限，同时评论按评论上限收窄 */
    draftLimit: number
    isDraftOverLimit: boolean
    isSubmitting: boolean
    pendingDelete: WeiboRepostItem | null
    isDestroying: boolean
    setDraft: (value: string) => void
    setShouldComment: (value: boolean) => void
    submit: () => Promise<void>
    handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    requestDelete: (repost: WeiboRepostItem) => void
    cancelDelete: () => void
    confirmDelete: () => Promise<void>
}

export function useWeiboRepostActions({
    postId,
    reload,
    onCommitted,
}: UseWeiboRepostActionsOptions): WeiboRepostActions {
    /** 同时评论：关闭即只转发（is_comment=0），打开即转发并评论（is_comment=1） */
    const [shouldComment, setShouldComment] = useState(false)
    /** 转发附言草稿：转发成功即清空 */
    const [draft, setDraft] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    /** 待删除转发：非空即打开确认框，同一时刻只处理一条 */
    const [pendingDelete, setPendingDelete] = useState<WeiboRepostItem | null>(null)
    const [isDestroying, setIsDestroying] = useState(false)
    /** 写操作占位：ref 判定，避开同一帧连点读到旧 state */
    const isSubmittingRef = useRef(false)
    const isDestroyingRef = useRef(false)

    const trimmedDraft = draft.trim()
    const draftLimit = shouldComment ? WEIBO_COMMENT_MAX_LENGTH : WEIBO_REPOST_MAX_LENGTH
    const isDraftOverLimit = trimmedDraft.length > draftLimit

    /** 提交转发：附言可空，成功后清空输入并重拉第一页，写操作失败弹 toast 让用户重试 */
    const submit = useCallback(async (): Promise<void> => {
        if (isSubmittingRef.current || isDraftOverLimit) {
            return
        }
        isSubmittingRef.current = true
        setIsSubmitting(true)
        try {
            await request<WeiboRepostCreateResult>(
                WEIBO_METHODS.repost,
                { id: postId, comment: trimmedDraft, mode: shouldComment ? 'repostWithComment' : 'repost' },
                REQUEST_TIMEOUT_MS,
            )
            setDraft('')
            onCommitted(1)
            toast.success(shouldComment ? WEIBO_UI_TEXT.toast.repostedWithComment : WEIBO_UI_TEXT.toast.reposted)
            await reload()
        } catch (cause) {
            toastError(cause)
        } finally {
            isSubmittingRef.current = false
            setIsSubmitting(false)
        }
    }, [isDraftOverLimit, onCommitted, postId, reload, shouldComment, trimmedDraft])

    /** 删除自己的转发：只在确认框里触发，成功后重拉第一页并收起确认框 */
    const confirmDelete = useCallback(async (): Promise<void> => {
        const target = pendingDelete
        if (target === null || isDestroyingRef.current) {
            return
        }
        isDestroyingRef.current = true
        setIsDestroying(true)
        try {
            await request<WeiboDestroyStatusResult>(WEIBO_METHODS.destroyStatus, { id: target.id }, REQUEST_TIMEOUT_MS)
            toast.success(WEIBO_UI_TEXT.toast.repostDeleted)
            setPendingDelete(null)
            onCommitted(-1)
            await reload()
        } catch (cause) {
            toastError(cause)
        } finally {
            isDestroyingRef.current = false
            setIsDestroying(false)
        }
    }, [onCommitted, pendingDelete, reload])

    const requestDelete = useCallback((repost: WeiboRepostItem): void => {
        setPendingDelete(repost)
    }, [])

    const cancelDelete = useCallback((): void => {
        setPendingDelete(null)
    }, [])

    /** Ctrl / Cmd + Enter 直接发送：面板里敲附言不走表单回流 */
    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLTextAreaElement>): void => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void submit()
            }
        },
        [submit],
    )

    return {
        draft,
        shouldComment,
        draftLimit,
        isDraftOverLimit,
        isSubmitting,
        pendingDelete,
        isDestroying,
        setDraft,
        setShouldComment,
        submit,
        handleKeyDown,
        requestDelete,
        cancelDelete,
        confirmDelete,
    }
}
