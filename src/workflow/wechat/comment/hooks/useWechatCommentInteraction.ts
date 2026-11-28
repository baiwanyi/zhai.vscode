/**
 * 留言页交互状态：筛选、详情、回复草稿与待删项，以及由它们派生的视图数据和动作。
 * 复用约定：数据取 useWechatComments，筛选与计数走 utils/commentFilter，文案与文章上下文走 utils/commentText，
 * 续载观察走 useScrollSentinel；动作统一收拢为 WechatCommentActions 下发，避免页面逐条透传回调。
 * 关键约束：详情、回复与待删项都绑定某一条留言，切换批次或文章时整体清空，避免误操作上一篇的留言；
 * 回复草稿全页只保留一份，行内与详情共用；删除确认不叠在详情之上，先收起详情再弹确认；
 * 提交期间切到别的留言时只清理本条草稿，不覆盖新打开的那份；
 * 写动作按「类型 + 留言 id」加同步锁，同帧双击在 disabled 生效前就被挡住。
 */
import { useMemo, useRef, useState } from 'react'
import type { WechatCommentSummary } from '@shared/types/wechat'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { WechatCommentsState } from '../../hooks/useWechatComments'
import type { CommentFilter, CommentReplyDraft, WechatCommentActions } from '../types'
import type { CommentFilterCounts } from '../utils/commentFilter'
import type { RefObject } from 'react'
import { countComments, filterComments } from '../utils/commentFilter'
import { readArticleLabel, readPageDescription } from '../utils/commentText'

/** 留言页交互视图：页面只做装配，持有状态与命令的编排都在本 Hook 内 */
export interface WechatCommentInteraction {
    filter: CommentFilter
    counts: CommentFilterCounts
    visibleComments: WechatCommentSummary[]
    description: string
    articleLabel: string
    canOpenArticle: boolean
    detailComment: WechatCommentSummary | null
    detailReplyDraft: string | null
    pendingRemove: WechatCommentSummary | null
    replyDraft: CommentReplyDraft | null
    /** 当前文章的评论开关状态：null 表示没有选中文章 */
    isCommentEnabled: boolean | null
    hasMore: boolean
    sentinelRef: RefObject<HTMLDivElement | null>
    actions: WechatCommentActions
}

export function useWechatCommentInteraction(accountName: string, state: WechatCommentsState): WechatCommentInteraction {
    const [filter, setFilter] = useState<CommentFilter>('all')
    /** 详情快照：列表刷新后优先取最新一份，取不到（如已被挤到下一页）时退回快照 */
    const [detailSnapshot, setDetailSnapshot] = useState<WechatCommentSummary | null>(null)
    const [reply, setReply] = useState<CommentReplyDraft | null>(null)
    const [pendingRemove, setPendingRemove] = useState<WechatCommentSummary | null>(null)
    /** 写动作同步锁：state 更新滞后于同帧双击，disabled 生效前第二次点击仍会触发回调 */
    const inflightWritesRef = useRef<Set<string>>(new Set())

    const counts = useMemo(() => countComments(state.comments), [state.comments])
    const visibleComments = useMemo(() => filterComments(state.comments, filter), [state.comments, filter])

    /** 当前批次与文章：页头描述、详情的「所属文章」与原文入口共用同一份推导结果 */
    const selectedIssue = state.issues.find((issue) => issue.id === state.selectedIssueId)
    const selectedArticle = selectedIssue?.articles.find((article) => article.sortIndex === state.selectedSortIndex)
    const description = readPageDescription(
        accountName,
        selectedArticle === undefined ? null : selectedArticle.title,
        state.total,
    )
    const articleLabel =
        selectedArticle === undefined
            ? '所属文章未知'
            : readArticleLabel(selectedArticle.sortIndex, selectedArticle.title)
    /** 原文入口：平台只回传多图文首篇的链接，第二篇起与旧批次都没有自己的地址 */
    const canOpenArticle = state.selectedSortIndex === 1 && selectedIssue?.articleUrl !== undefined
    /** 评论开关：状态取本地文章元信息，平台没有查询接口；没有选中文章时不显示开关 */
    const isCommentEnabled = selectedArticle?.allowComment ?? null

    const detailComment =
        detailSnapshot === null
            ? null
            : (state.comments.find((comment) => comment.id === detailSnapshot.id) ?? detailSnapshot)
    /** 详情里正在编辑的回复草稿：只有草稿与当前详情是同一条时才下传 */
    const detailReplyDraft =
        reply !== null && detailComment !== null && reply.commentId === detailComment.id ? reply.content : null

    const hasMore = state.comments.length < state.total
    // 条目数作为观察信号：首屏未填满时靠它重建观察，才能链式补载；onLoadMore 用 hook 的稳定引用
    const sentinelRef = useScrollSentinel({
        hasMore,
        onLoadMore: state.loadMore,
        observeKey: state.comments.length,
    })

    /** 数据源切换后的统一清理：这些状态都指向上一篇文章的某条留言 */
    const resetTransientState = (): void => {
        setFilter('all')
        setDetailSnapshot(null)
        setReply(null)
        setPendingRemove(null)
    }

    /**
     * 写动作的同步幂等：键为「动作类型:留言 id」，同一条留言的同类操作在飞行中只放行一次。
     * 锁放在 ref 而非 state，避免设锁的渲染延迟让第二次点击穿透；finally 保证失败也释放。
     */
    const runWriteOnce = (key: string, action: () => Promise<void>): void => {
        if (inflightWritesRef.current.has(key)) {
            return
        }
        inflightWritesRef.current.add(key)
        // 底层 runWrite 已负责错误提示，这里吞掉异常只保证锁一定释放，避免 unhandled rejection
        void action()
            .catch(() => undefined)
            .finally(() => {
                inflightWritesRef.current.delete(key)
            })
    }

    const actions: WechatCommentActions = {
        onChangeFilter: setFilter,
        onSelectIssue: (issueId) => {
            resetTransientState()
            state.selectIssue(issueId)
        },
        onSelectArticle: (sortIndex) => {
            if (sortIndex === state.selectedSortIndex) {
                return
            }
            resetTransientState()
            state.selectArticle(sortIndex)
        },
        onReload: () => {
            void state.reload()
        },
        onLoadMore: () => {
            void state.loadMore()
        },
        onOpenDetail: (comment) => {
            setDetailSnapshot(comment)
        },
        onCloseDetail: () => {
            // 只收起详情：回复草稿由打开、取消与提交各自接管，误关弹窗不该丢输入
            setDetailSnapshot(null)
        },
        onReply: (comment) => {
            setReply({ commentId: comment.id, content: comment.replyContent ?? '' })
        },
        onReplyChange: (value) => {
            setReply((previous) => (previous === null ? null : { ...previous, content: value }))
        },
        onReplySubmit: () => {
            const draft = reply
            if (draft === null || draft.content.trim().length === 0) {
                return
            }
            runWriteOnce(`reply:${String(draft.commentId)}`, async (): Promise<void> => {
                const isReplied = await state.reply(draft.commentId, draft.content.trim())
                // 提交期间用户可能切到别的留言：只清理本条草稿，不覆盖新打开的那份
                if (isReplied) {
                    setReply((previous) =>
                        previous !== null && previous.commentId === draft.commentId ? null : previous,
                    )
                }
            })
        },
        onReplyCancel: () => {
            setReply(null)
        },
        onToggleElected: (comment) => {
            runWriteOnce(`mark:${String(comment.id)}`, async (): Promise<void> => {
                await state.mark(comment.id, !comment.isElected)
            })
        },
        onRequestRemove: (comment) => {
            setDetailSnapshot(null)
            setReply(null)
            setPendingRemove(comment)
        },
        onCloseRemove: () => {
            setPendingRemove(null)
        },
        onConfirmRemove: () => {
            const target = pendingRemove
            setPendingRemove(null)
            if (target !== null) {
                runWriteOnce(`remove:${String(target.id)}`, async (): Promise<void> => {
                    await state.remove(target.id)
                })
            }
        },
        onToggleComment: (enabled) => {
            if (selectedIssue === undefined) {
                return
            }
            runWriteOnce(`switch:${selectedIssue.id}:${String(state.selectedSortIndex)}`, async (): Promise<void> => {
                await state.switchComment(enabled)
            })
        },
        onOpenArticle: () => {
            void state.openArticle()
        },
    }

    return {
        filter,
        counts,
        visibleComments,
        description,
        articleLabel,
        canOpenArticle,
        detailComment,
        detailReplyDraft,
        pendingRemove,
        replyDraft: reply,
        isCommentEnabled,
        hasMore,
        sentinelRef,
        actions,
    }
}
