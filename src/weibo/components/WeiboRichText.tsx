/**
 * 富文本正文：按分段渲染文本与表情，表情进入视口后才经宿主代理取图。
 * 复用约定：数据来自 WeiboTimelineSegment[]，文本段已在宿主剥标签解实体；
 * 表情地址已按图床白名单收窄，本组件只负责懒加载与失败回退。
 * 关键约束：hooks 只能在组件内调用，故表情单独抽成子组件，不能在 map 里直接调；
 * 取图失败退回 `[名称]` 文本，保证正文可读且不破坏行内排版。
 */
import type { WeiboTimelineSegment } from '@shared/types/weibo'
import type { JSX } from 'react'
import { useHasEnteredViewport } from '../hooks/useHasEnteredViewport'
import { useWeiboImage } from '../hooks/useWeiboImage'

interface WeiboEmojiProps {
    name: string
    remoteUrl: string
}

/** 单个表情：懒加载，失败与加载中都显示 `[名称]` */
function WeiboEmoji({ name, remoteUrl }: WeiboEmojiProps): JSX.Element {
    const { ref, hasEntered } = useHasEnteredViewport()
    const { localUrl, isFailed } = useWeiboImage(hasEntered ? remoteUrl : '')
    const label = name.length > 0 ? `[${name}]` : ''

    if (isFailed || localUrl === null) {
        return (
            <span ref={hasEntered ? undefined : ref} className="text-muted-foreground">
                {label}
            </span>
        )
    }
    return (
        <img
            src={localUrl}
            alt={name}
            title={name}
            className="mx-0.5 inline-block size-4 align-text-bottom"
            loading="lazy"
        />
    )
}

interface WeiboRichTextProps {
    segments: WeiboTimelineSegment[]
    /** 没有正文时的兜底文案 */
    placeholder?: string
}

export function WeiboRichText({ segments, placeholder = '（无正文）' }: WeiboRichTextProps): JSX.Element {
    if (segments.length === 0) {
        return <>{placeholder}</>
    }
    return (
        <>
            {segments.map((segment, index) =>
                segment.type === 'text' ? (
                    <span key={`text-${String(index)}`}>{segment.text}</span>
                ) : (
                    <WeiboEmoji key={`emoji-${String(index)}`} name={segment.name} remoteUrl={segment.url} />
                ),
            )}
        </>
    )
}
