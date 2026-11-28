/**
 * 留言详情弹窗：完整正文、时间与状态、作者回复，以及回复 / 精选 / 删除三个动作的入口。
 * 复用约定：外壳取 components/Dialog（内容区自带滚动），内容用 @components/ui/card 的完整组合
 * （CardHeader / CardTitle / CardDescription / CardContent / CardFooter），徽标取 blocks/Badge，
 * 按钮取 components/Button，回复编辑区复用同目录 WechatCommentReplyForm，文案取 utils/commentText；
 * 原文跳转只发起请求，地址由宿主取库并校验域名、在 VS Code 内置浏览器打开，前端不持有 URL。
 * 关键约束：数据由父层从最新列表里重取后传入，弹窗不缓存副本——写操作刷新后详情跟着变；
 * 正文按原文展示（保留换行、不做 Markdown 渲染），读者输入不能被当作文档解释；
 * 没有平台链接时（多图文非首篇、旧批次）不渲染原文按钮，避免点了才发现打不开；
 * 删除只关闭详情并交给父层的确认框，弹窗内不再叠一层确认，避免两层浮层抢焦点；
 * 打开时就把焦点收进弹窗，弹窗外的列表在遮罩下无法聚焦，焦点留在外面会让键盘用户失去落点。
 */
import { ExternalLink } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import type { WechatCommentSummary } from '@shared/types/wechat'
import { Badge } from '@webview/blocks/Badge'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import { WechatCommentReplyForm } from './WechatCommentReplyForm'
import type { WechatCommentActions } from '../types'
import type { JSX } from 'react'
import { hasCommentReply } from '../utils/commentFilter'
import { readCommentDetailTime, readFanLabel } from '../utils/commentText'

interface WechatCommentDetailDialogProps {
    /** null 表示关闭；父层传入列表中的最新一份数据 */
    comment: WechatCommentSummary | null
    /** 所属文章（第 N 篇 · 标题）：留言按文章定位，详情里必须能回答「这条挂在哪」 */
    articleLabel: string
    /** 该文章是否有平台回写的原文链接：多图文只有首篇有，旧批次也没有 */
    canOpenArticle: boolean
    isMutating: boolean
    /** 本条留言的回复草稿：null 表示没有展开编辑区 */
    replyDraft: string | null
    actions: WechatCommentActions
}

export function WechatCommentDetailDialog({
    comment,
    articleLabel,
    canOpenArticle,
    isMutating,
    replyDraft,
    actions,
}: WechatCommentDetailDialogProps): JSX.Element {
    const isOpen = comment !== null
    const hasReply = hasCommentReply(comment)

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    actions.onCloseDetail()
                }
            }}
            title="留言详情"
            description={comment === null ? undefined : `${readCommentDetailTime(comment)} · #${String(comment.id)}`}
            showFooter={false}
            // 打开即把焦点交给弹窗：否则焦点滞留在遮罩后的列表按钮上，键盘用户按 Tab 会找不到落点
            autoFocus
        >
            {comment === null ? null : (
                <Card size="sm">
                    <CardHeader>
                        <CardTitle>{readFanLabel(comment.openid)}</CardTitle>
                        <CardAction className="flex flex-wrap items-center justify-end gap-1.5">
                            <Badge variant={comment.isElected ? 'secondary' : 'outline'}>
                                {comment.isElected ? '精选' : '未精选'}
                            </Badge>
                            <Badge variant="outline">{hasReply ? '已回复' : '待回复'}</Badge>
                            {canOpenArticle ? (
                                <Button
                                    className="shrink-0"
                                    variant="outline"
                                    size="xs"
                                    disabled={isMutating}
                                    onClick={actions.onOpenArticle}
                                >
                                    <ExternalLink data-icon="inline-start" />
                                    打开原文
                                </Button>
                            ) : null}
                        </CardAction>
                        <CardDescription className="truncate" title={articleLabel}>
                            {articleLabel}
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-3">
                        <p className="whitespace-pre-wrap wrap-break-word rounded-lg border p-2 text-sm">
                            {comment.content}
                        </p>

                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">回复</span>
                            {comment.replyContent === undefined ? (
                                <p className="text-xs text-muted-foreground">未回复</p>
                            ) : (
                                <p className="whitespace-pre-wrap wrap-break-word rounded-md bg-muted/40 p-2 text-xs">
                                    {comment.replyContent}
                                </p>
                            )}
                        </div>
                    </CardContent>

                    <CardFooter className="justify-end">
                        {replyDraft === null ? (
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                    variant="outline"
                                    disabled={isMutating}
                                    onClick={() => actions.onReply(comment)}
                                >
                                    {hasReply ? '修改回复' : '回复'}
                                </Button>
                                <Button
                                    variant="outline"
                                    disabled={isMutating}
                                    onClick={() => actions.onToggleElected(comment)}
                                >
                                    {comment.isElected ? '取消精选' : '设为精选'}
                                </Button>
                                <Button
                                    variant="destructive"
                                    disabled={isMutating}
                                    onClick={() => actions.onRequestRemove(comment)}
                                >
                                    删除
                                </Button>
                            </div>
                        ) : (
                            <WechatCommentReplyForm
                                value={replyDraft}
                                isMutating={isMutating}
                                hasReply={hasReply}
                                onChange={actions.onReplyChange}
                                onSubmit={actions.onReplySubmit}
                                onCancel={actions.onReplyCancel}
                            />
                        )}
                    </CardFooter>
                </Card>
            )}
        </Dialog>
    )
}
