/**
 * 富文本正文：按分段渲染文本、表情与正文链接，表情进入视口后才经宿主代理取图。
 * 复用约定：数据来自 WeiboTimelineSegment[]，文本段已在宿主剥标签解实体，
 * 链接段的地址也已收窄到微博域名白名单；打开动作统一走 hooks/useWeiboOpenUrl。
 * 关键约束：hooks 只能在组件内调用，故表情与链接各自抽成子组件，不能在 map 里直接调；
 * 取图失败退回 `[名称]` 文本，保证正文可读且不破坏行内排版；
 * 链接点击一律阻止 webview 自身导航，否则会把整块面板顶掉；
 * 链接统一用橙色标识可点，且不设 title——悬停浮出整串地址既冗余又挡住正文；
 * 标题行等非正文场景可经 className 覆盖外观（如沿用 muted 灰、悬停才变链接色）。
 */
import { cn } from 'cn'
import { useCallback } from 'react'
import type { WeiboTimelineSegment } from '@shared/types/weibo'
import type { JSX, MouseEvent } from 'react'
import { useHasEnteredViewport } from '../hooks/useHasEnteredViewport'
import { useWeiboImage } from '../hooks/useWeiboImage'
import { useWeiboOpenUrl } from '../hooks/useWeiboOpenUrl'

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

interface WeiboLinkProps {
    text: string
    url: string
    /** 外观覆盖：默认沿用正文链接样式，标题行等场景可自选颜色与字号 */
    className?: string
}

/**
 * 正文链接：@账号、#话题#、#超话# 与短链共用一套外观，点击交给宿主在浏览器打开。
 * 关键约束：保留 `<a href>` 只为键盘可达与状态栏预览，导航必须被阻止——
 * webview 内直接跳转会把面板顶掉，真正的打开动作由 useWeiboOpenUrl 完成。
 */
export function WeiboLink({ text, url, className }: WeiboLinkProps): JSX.Element {
    const openUrl = useWeiboOpenUrl()

    const handleClick = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault()
            openUrl(url)
        },
        [openUrl, url],
    )

    return (
        <a
            href={url}
            onClick={handleClick}
            className={cn('cursor-pointer wrap-break-word text-link hover:underline dark:text-link pr-0.5', className)}
        >
            {text}
        </a>
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
            {segments.map((segment, index) => {
                if (segment.type === 'text') {
                    return <span key={`text-${String(index)}`}>{segment.text}</span>
                }
                if (segment.type === 'link') {
                    return <WeiboLink key={`link-${String(index)}`} text={segment.text} url={segment.url} />
                }
                return <WeiboEmoji key={`emoji-${String(index)}`} name={segment.name} remoteUrl={segment.url} />
            })}
        </>
    )
}
