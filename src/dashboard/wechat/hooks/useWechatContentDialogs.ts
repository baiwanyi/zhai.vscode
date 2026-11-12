/**
 * 文章与批次的弹窗编排：文章设置、封面裁剪、删除文章、删除批次四组目标状态与提交动作。
 * 复用约定：目标状态一律「非 null 即打开」，关闭走 close()，宿主动作由页面从 useWechatIssues 注入；
 * 提交前先判空目标，弹窗关闭后再清空目标，避免关闭动画期间读到空引用。
 * 关键约束：文章设置的提交不回传标题——标题由编辑器一级标题维护，回传列表快照会把新标题改回旧值；
 * 删除类动作统一「先关弹窗再提交」，失败时结果由宿主的 toast 呈现，不在本层重复提示。
 */
import { useCallback, useState } from 'react'
import type { WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import type { WechatArticleMetaInput } from './useWechatIssues'

/** 文章设置表单的可编辑字段：标题与封面不在本入口修改 */
export interface WechatArticleMetaDraft {
    author: string
    digest: string
    allowComment: boolean
}

export interface WechatContentDialogsDeps {
    updateArticleMeta: (input: WechatArticleMetaInput) => Promise<boolean>
    saveArticleCover: (id: string, dataUrl: string) => Promise<boolean>
    removeArticle: (id: string) => Promise<boolean>
    removeIssue: (id: string) => Promise<boolean>
}

export interface WechatContentDialogsState {
    meta: {
        target: WechatArticleSummary | null
        open: (article: WechatArticleSummary) => void
        close: () => void
        submit: (draft: WechatArticleMetaDraft) => Promise<boolean>
    }
    cover: {
        target: WechatArticleSummary | null
        open: (article: WechatArticleSummary) => void
        close: () => void
        submit: (dataUrl: string) => Promise<boolean>
    }
    articleRemove: {
        target: WechatArticleSummary | null
        request: (article: WechatArticleSummary) => void
        close: () => void
        confirm: () => void
    }
    issueRemove: {
        target: WechatIssueSummary | null
        request: (issue: WechatIssueSummary) => void
        close: () => void
        confirm: () => void
    }
}

export function useWechatContentDialogs(deps: WechatContentDialogsDeps): WechatContentDialogsState {
    const { removeArticle, removeIssue, saveArticleCover, updateArticleMeta } = deps
    const [metaTarget, setMetaTarget] = useState<WechatArticleSummary | null>(null)
    const [coverTarget, setCoverTarget] = useState<WechatArticleSummary | null>(null)
    /** 待删除的文章：删除只依赖文章本身，不需要批次上下文 */
    const [pendingArticle, setPendingArticle] = useState<WechatArticleSummary | null>(null)
    const [pendingIssue, setPendingIssue] = useState<WechatIssueSummary | null>(null)

    /** 保存文章设置：只改作者、摘要与留言开关，标题由编辑器一级标题维护 */
    const submitMeta = useCallback(
        async (draft: WechatArticleMetaDraft): Promise<boolean> => {
            if (metaTarget === null) {
                return false
            }
            return updateArticleMeta({
                id: metaTarget.id,
                author: draft.author,
                digest: draft.digest,
                allowComment: draft.allowComment,
            })
        },
        [metaTarget, updateArticleMeta],
    )

    /** 保存裁剪封面：落盘与回写由宿主完成，成功后弹窗关闭、列表刷新 */
    const submitCover = useCallback(
        async (dataUrl: string): Promise<boolean> => {
            if (coverTarget === null) {
                return false
            }
            return saveArticleCover(coverTarget.id, dataUrl)
        },
        [coverTarget, saveArticleCover],
    )

    const confirmArticleRemove = useCallback((): void => {
        if (pendingArticle === null) {
            return
        }
        const target = pendingArticle
        setPendingArticle(null)
        void removeArticle(target.id)
    }, [pendingArticle, removeArticle])

    const confirmIssueRemove = useCallback((): void => {
        if (pendingIssue === null) {
            return
        }
        const target = pendingIssue
        setPendingIssue(null)
        void removeIssue(target.id)
    }, [pendingIssue, removeIssue])

    return {
        meta: { target: metaTarget, open: setMetaTarget, close: () => setMetaTarget(null), submit: submitMeta },
        cover: { target: coverTarget, open: setCoverTarget, close: () => setCoverTarget(null), submit: submitCover },
        articleRemove: {
            target: pendingArticle,
            request: setPendingArticle,
            close: () => setPendingArticle(null),
            confirm: confirmArticleRemove,
        },
        issueRemove: {
            target: pendingIssue,
            request: setPendingIssue,
            close: () => setPendingIssue(null),
            confirm: confirmIssueRemove,
        },
    }
}
