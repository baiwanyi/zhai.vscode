/**
 * 富文本正文：按分段渲染文本、表情与正文链接，表情进入视口后才经宿主代理取图。
 * 复用约定：数据来自 WeiboTimelineSegment[]，文本段已在宿主剥标签解实体，
 * 链接段的地址也已收窄到微博域名白名单；打开动作统一走 hooks/useWeiboOpenUrl。
 * 关键约束：hooks 只能在组件内调用，故表情与链接各自抽成子组件，不能在 map 里直接调；
 * 取图失败退回 `[名称]` 文本，保证正文可读且不破坏行内排版；
 * 链接不能渲染成带 href 的 `<a>`：VS Code webview 会把带 href 的点击交给系统浏览器，
 * 只靠 preventDefault 拦不住，主页面板会被顶掉；改用 role="link" + tabIndex 的内联元素，
 * Enter 与空格同样可激活，键盘可达性不靠 href；
 * 链接统一用橙色标识可点，且不设 title——悬停浮出整串地址既冗余又挡住正文；
 * 标题行等非正文场景可经 className 覆盖外观（如沿用 muted 灰、悬停才变链接色）。
 */
import { cn } from 'cn'
import { useCallback } from 'react'
import type { WeiboTimelineSegment } from '@shared/types/weibo'
import { useHasEnteredViewport } from '@webview/hooks/useHasEnteredViewport'
import type { JSX, KeyboardEvent } from 'react'
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
 * 正文链接：@账号、#话题#、#超话# 与短链共用一套外观，点击交给 useWeiboOpenUrl 分发。
 * 关键约束：不带 href——webview 拦截到 href 就交给系统浏览器，页内打开会被同一跳转抢走；
 * 语义与时序改由 role="link" + tabIndex 承担，Enter / 空格与点击等价。
 */
export function WeiboLink({ text, url, className }: WeiboLinkProps): JSX.Element {
    const openUrl = useWeiboOpenUrl()

    const handleActivate = useCallback((): void => {
        openUrl(url)
    }, [openUrl, url])

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLSpanElement>): void => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return
            }
            // 空格默认会滚动页面，激活链接时先吃掉
            event.preventDefault()
            handleActivate()
        },
        [handleActivate],
    )

    return (
        <span
            role="link"
            tabIndex={0}
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
            className={cn(
                'cursor-pointer wrap-break-word text-link hover:underline focus-visible:underline dark:text-link pr-0.5',
                className,
            )}
        >
            {text}
        </span>
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
