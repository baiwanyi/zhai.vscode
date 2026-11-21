/**
 * 单条转发：头像、作者行（认证角标）、附言与删除入口，展示用派生值都在本组件内算。
 * 复用约定：正文与表情取 WeiboRichText，头像取 WeiboAvatar，作者名与时间分别取
 * @webview/weibo/utils 的 readWeiboAuthorName / formatWeiboTime。
 * 关键约束：删除入口是否渲染由调用方给出的 canDelete 决定，本组件不判当前账号（归属最终由上游判定）；
 * 纯转发没有附言，segments 为空时只渲染作者与时间，不留空段落。
 */
import { BadgeCheck } from 'lucide-react'
import type { WeiboRepostItem } from '@shared/types/weibo'
import { readWeiboAuthorName } from '@webview/weibo/utils/weiboAuthor'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { JSX } from 'react'

export interface RepostItemProps {
    repost: WeiboRepostItem
    canDelete: boolean
    onDelete: (repost: WeiboRepostItem) => void
}

export function RepostItem({ repost, canDelete, onDelete }: RepostItemProps): JSX.Element {
    return (
        <article className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
            <WeiboAvatar name={repost.author.name} avatarUrl={repost.author.avatarUrl} className="size-7 text-xs" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="text-xs font-medium">{readWeiboAuthorName(repost.author.name)}</span>
                    {repost.author.isVerified ? (
                        <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" />
                    ) : null}
                    <span className="text-muted-foreground text-[11px]">
                        {formatWeiboTime(repost.createdAt, repost.createdAtRaw)}
                    </span>
                </div>
                {repost.segments.length > 0 ? (
                    <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                        <WeiboRichText segments={repost.segments} />
                    </p>
                ) : null}
                {canDelete ? (
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <button
                            type="button"
                            className="transition-colors hover:text-destructive"
                            onClick={() => {
                                onDelete(repost)
                            }}
                        >
                            删除
                        </button>
                    </div>
                ) : null}
            </div>
        </article>
    )
}
