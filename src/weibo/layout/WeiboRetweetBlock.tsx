/**
 * 引用块：被转发原微博的作者行、折叠正文、长文状态与媒体区。
 * 复用约定：折叠正文交给 WeiboCollapsibleBody、长文状态交给 WeiboLongTextStatus、媒体交给 WeiboPostMediaGrid；
 * 全文与状态由卡片侧的 useWeiboLongText 注入（渲染端只消费，不自己发请求）。
 * 关键约束：作者行与主贴同构（作者名 + 认证角标 + @UID + 时间）；长文未到货时按摘要折叠，
 * 到货后按全文重新判定是否折叠；转发体没有 mblogid，全文请求用它的数字 id。
 */
import { useMemo } from 'react'
import { isWeiboTimelineId } from '@shared/types/weibo'
import type { WeiboTimelineRetweet, WeiboTimelineSegment } from '@shared/types/weibo'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import type { WeiboLongTextController } from '@webview/weibo/hooks/useWeiboLongText'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import type { JSX, Ref } from 'react'
import { WeiboAuthorName } from '../block/WeiboAuthorName'
import { WeiboCollapsibleBody } from '../block/WeiboCollapsibleBody'
import { WeiboLongTextStatus } from '../block/WeiboLongTextStatus'
import { WeiboPostMediaGrid } from '../block/WeiboPostMediaGrid'

/**
 * 转发体正文分段：全文优先，其次归一化阶段切好的分段，最后才从纯文本补链接。
 * 用早返回替掉原三层三元，读起来是一条直线。
 */
function resolveRetweetSegments(retweeted: WeiboTimelineRetweet, fullText: string | null): WeiboTimelineSegment[] {
    if (fullText !== null) {
        return splitPlainTextLinks(fullText)
    }
    if (retweeted.segments.length > 0) {
        return retweeted.segments
    }
    return splitPlainTextLinks(retweeted.text)
}

export interface WeiboRetweetBlockProps {
    retweeted: WeiboTimelineRetweet
    /** 转发体的长文控制器：fullText / 状态 / 重试入口 */
    longText: WeiboLongTextController
    /** 打开被转发的原文（视频封面与兜底入口都用它） */
    onOpenPost: () => void
    /** 引用块的挂载点：卡片用它判断是否进入视口 */
    contentRef: Ref<HTMLQuoteElement>
}

export function WeiboRetweetBlock({
    retweeted,
    longText,
    onOpenPost,
    contentRef,
}: WeiboRetweetBlockProps): JSX.Element {
    const text = longText.fullText ?? retweeted.text
    /** 全文切分是 O(n) 正则，卡片上点赞 / 展开评论都会重渲染，故按依赖缓存一份 */
    const segments = useMemo<WeiboTimelineSegment[]>(
        () => resolveRetweetSegments(retweeted, longText.fullText),
        [longText.fullText, retweeted],
    )
    /** 时间文案：解析失败或上游缺失时为空串，空串不再渲染占位（与主贴头部一致） */
    const timeText = formatWeiboTime(retweeted.createdAt, retweeted.createdAtRaw)

    return (
        <blockquote
            ref={contentRef}
            className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground ring-1 ring-foreground/5"
        >
            {/* 作者行与主贴同构：作者名 + 认证角标 + @UID，下一行单独放发布时间 */}
            <div className="flex flex-wrap items-center gap-1">
                <WeiboAuthorName
                    className="font-medium text-foreground"
                    name={retweeted.authorName}
                    isVerified={retweeted.authorIsVerified}
                    fallback="原作者"
                />
                {/* 与主贴头部同一口径：只有合法数字 uid 才展示 @UID */}
                {isWeiboTimelineId(retweeted.authorId) ? (
                    <>
                        <span className="shrink-0 text-muted-foreground">@{retweeted.authorId}</span>
                        <span className="shrink-0 text-muted-foreground">·</span>
                    </>
                ) : null}
                {timeText.length > 0 ? <span className="shrink-0 text-muted-foreground">{timeText}</span> : null}
            </div>

            <WeiboCollapsibleBody
                text={text}
                segments={segments}
                placeholder="（原微博不可见）"
                fadeClassName="from-muted"
            />
            {retweeted.isLongText && longText.fullText === null ? (
                <WeiboLongTextStatus
                    isLoading={longText.isLoading}
                    hasFailed={longText.hasFailed}
                    onRetry={() => {
                        longText.requestFullText(true)
                    }}
                />
            ) : null}

            {/* 引用微博的图片与视频同样要展示：媒体结构与主贴一致，图片就地展开预览，视频回被转发的原文 */}
            <WeiboPostMediaGrid media={retweeted.media} onOpenPost={onOpenPost} />
        </blockquote>
    )
}
