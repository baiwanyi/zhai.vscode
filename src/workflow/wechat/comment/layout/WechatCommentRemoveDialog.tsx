/**
 * 删除确认：留言删除不可撤销，统一走公共 AlertDialog，并在文案里带上正文摘要。
 * 复用约定：外壳取 components/AlertDialog（受控 open、破坏性确认、提交中拦截关闭），
 * 摘要取 utils/commentText 的 readCommentExcerpt，长正文不整段铺进确认框。
 * 关键约束：comment 为 null 表示没有待删项；确认由父层执行并先行清空待删项，本组件不自行关闭；
 * 删除结果以重新拉取的列表为准，这里不做乐观更新。
 */
import type { WechatCommentSummary } from '@shared/types/wechat'
import { AlertDialog } from '@webview/components/AlertDialog'
import type { WechatCommentActions } from '../types'
import type { JSX } from 'react'
import { readCommentExcerpt } from '../utils/commentText'

interface WechatCommentRemoveDialogProps {
    /** 待删除的留言：null 表示没有待确认项 */
    comment: WechatCommentSummary | null
    isSubmitting: boolean
    actions: WechatCommentActions
}

export function WechatCommentRemoveDialog({
    comment,
    isSubmitting,
    actions,
}: WechatCommentRemoveDialogProps): JSX.Element {
    return (
        <AlertDialog
            open={comment !== null}
            title="删除留言"
            description={
                comment === null ? '' : `删除「${readCommentExcerpt(comment.content)}」后读者端同步消失，且不可恢复。`
            }
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={(open) => {
                if (!open) {
                    actions.onCloseRemove()
                }
            }}
            onConfirm={actions.onConfirmRemove}
        />
    )
}
