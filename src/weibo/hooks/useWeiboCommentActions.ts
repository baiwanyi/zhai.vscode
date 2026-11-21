/**
 * 评论写操作：草稿校验、发布 / 回复 / 同时转发、删除确认与提交，全部收在这里。
 * 复用约定：协议方法名取 @shared/types/weiboMethods，字数上限取 @shared/types/weibo，
 * 错误提示取 @shared/utils/error；提交成功后统一走调用方注入的 reload 重拉第一页。
 * 关键约束：写操作用 ref 单飞，避开同一帧连点读到旧 state；
 * 「同时转发」是评论 + 转发两步，评论已发而转发失败按部分成功处理——清空草稿并关掉开关，
 * 避免用户再点一次把同一条评论发重；回复只走评论回复端点，不带转发。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WEIBO_COMMENT_MAX_LENGTH } from '@shared/types/weibo'
import type {
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentItem,
    WeiboRepostCreateResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { KeyboardEvent } from 'react'

/** 评论写操作超时：发布、回复与删除都用同一口径，失败要尽快让用户重试 */
const MUTATE_TIMEOUT_MS = 20_000

/** 回复目标：只用评论 id 与作者名，正文由同一个发布框提交 */
export interface CommentReplyTarget {
    id: string
    authorName: string
}

export interface UseWeiboCommentActionsOptions {
    /** 微博数字 id */
    postId: string
    /** 写成功后重拉第一页：由取数 Hook 提供 */
    reload: () => Promise<void>
}

export interface WeiboCommentActions {
    draft: string
    isDraftValid: boolean
    shouldRepost: boolean
    replyTarget: CommentReplyTarget | null
    isSubmitting: boolean
    pendingDelete: WeiboCommentItem | null
    isDestroying: boolean
    setDraft: (value: string) => void
    setShouldRepost: (value: boolean) => void
    beginReply: (target: CommentReplyTarget) => void
    cancelReply: () => void
    submit: () => Promise<void>
    handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    requestDelete: (comment: WeiboCommentItem) => void
    cancelDelete: () => void
    confirmDelete: () => Promise<void>
}

export function useWeiboCommentActions({ postId, reload }: UseWeiboCommentActionsOptions): WeiboCommentActions {
    /** 发布框草稿：发布或回复成功即清空 */
    const [draft, setDraft] = useState('')
    /** 同时转发：评论的同时把这条微博转到自己主页，与回复互斥（回复不支持转发） */
    const [shouldRepost, setShouldRepost] = useState(false)
    /** 回复目标：非空时提交走回复端点，发布框上方回显被回复对象 */
    const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    /** 待删除评论：非空即打开确认框，同一时刻只处理一条 */
    const [pendingDelete, setPendingDelete] = useState<WeiboCommentItem | null>(null)
    const [isDestroying, setIsDestroying] = useState(false)
    /** 写操作占位：ref 判定，避开同一帧连点读到旧 state */
    const isSubmittingRef = useRef(false)
    const isDestroyingRef = useRef(false)

    const trimmedDraft = draft.trim()
    const isDraftValid = trimmedDraft.length > 0 && trimmedDraft.length <= WEIBO_COMMENT_MAX_LENGTH

    /** 同时转发：宿主两步完成，评论已发而转发失败时只提示部分成功，不再整单失败 */
    const submitWithRepost = useCallback(
        async (text: string): Promise<void> => {
            const result = await request<WeiboRepostCreateResult>(
                WEIBO_METHODS.repost,
                { id: postId, comment: text, mode: 'commentWithRepost' },
                MUTATE_TIMEOUT_MS,
            )
            setDraft('')
            setReplyTarget(null)
            if (result.commented && !result.reposted) {
                // 评论已发出、转发失败：关掉开关，避免再次两步提交把评论发重
                setShouldRepost(false)
                toast.warning(`评论已发布，但转发失败：${result.failureMessage ?? '未知原因'}`)
            } else {
                toast.success('已评论并转发')
            }
            await reload()
        },
        [postId, reload],
    )

    /** 发布或回复：只走评论端点，带 replyToId 即回复 */
    const submitPlainComment = useCallback(
        async (text: string, target: CommentReplyTarget | null): Promise<void> => {
            await request<WeiboCommentCreateResult>(
                WEIBO_METHODS.commentCreate,
                target === null ? { id: postId, text } : { id: postId, text, replyToId: target.id },
                MUTATE_TIMEOUT_MS,
            )
            setDraft('')
            setReplyTarget(null)
            toast.success(target === null ? '评论已发布' : `已回复 @${target.authorName}`)
            await reload()
        },
        [postId, reload],
    )

    /** 提交入口：只做单飞、按「是否回复 + 同时转发」分派与收尾 */
    const submit = useCallback(async (): Promise<void> => {
        if (isSubmittingRef.current || !isDraftValid) {
            return
        }
        isSubmittingRef.current = true
        setIsSubmitting(true)
        const target = replyTarget
        const text = trimmedDraft
        try {
            if (target === null && shouldRepost) {
                await submitWithRepost(text)
                return
            }
            await submitPlainComment(text, target)
        } catch (cause) {
            toastError(cause)
        } finally {
            isSubmittingRef.current = false
            setIsSubmitting(false)
        }
    }, [isDraftValid, replyTarget, shouldRepost, submitPlainComment, submitWithRepost, trimmedDraft])

    /** 删除自己的评论：确认框里触发，成功后重拉第一页并清掉对应的回复目标 */
    const confirmDelete = useCallback(async (): Promise<void> => {
        const target = pendingDelete
        if (target === null || isDestroyingRef.current) {
            return
        }
        isDestroyingRef.current = true
        setIsDestroying(true)
        try {
            await request<WeiboCommentDestroyResult>(
                WEIBO_METHODS.commentDestroy,
                { cid: target.id },
                MUTATE_TIMEOUT_MS,
            )
            toast.success('评论已删除')
            setPendingDelete(null)
            // 回复目标正好被删掉时一并清空，避免继续对不存在的评论提交回复
            if (replyTarget?.id === target.id) {
                setReplyTarget(null)
            }
            await reload()
        } catch (cause) {
            toastError(cause)
        } finally {
            isDestroyingRef.current = false
            setIsDestroying(false)
        }
    }, [pendingDelete, reload, replyTarget])

    const beginReply = useCallback((target: CommentReplyTarget): void => {
        setReplyTarget(target)
    }, [])

    const cancelReply = useCallback((): void => {
        setReplyTarget(null)
    }, [])

    const requestDelete = useCallback((comment: WeiboCommentItem): void => {
        setPendingDelete(comment)
    }, [])

    const cancelDelete = useCallback((): void => {
        setPendingDelete(null)
    }, [])

    /** Ctrl / Cmd + Enter 直接发送：面板里敲评论不走表单回流 */
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
        isDraftValid,
        shouldRepost,
        replyTarget,
        isSubmitting,
        pendingDelete,
        isDestroying,
        setDraft,
        setShouldRepost,
        beginReply,
        cancelReply,
        submit,
        handleKeyDown,
        requestDelete,
        cancelDelete,
        confirmDelete,
    }
}
