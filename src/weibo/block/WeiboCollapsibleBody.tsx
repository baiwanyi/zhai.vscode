/**
 * 长正文折叠：超过阈值先收成固定高度，底部渐隐并露一个下箭头提示可展开，点按钮看全、点「收起」再折回。
 * 复用约定：正文交给 WeiboRichText 渲染，排版与渐隐底色由调用方按所在区域传入；
 * 折叠容器的挂载点经 contentRef 透传，供调用方判断正文是否已进入视口。
 * 关键约束：是否折叠由当前文本长度直接算出而不落 state——摘要阶段够短就铺开，
 * 全文到货后变长再自动收起来；折叠只裁可视高度，DOM 照常渲染，表情与链接不因此丢失。
 */
import { cn } from 'cn'
import { ChevronsDown, ChevronsUp } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import type { WeiboTimelineSegment } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { WeiboRichText } from './WeiboRichText'
import type { JSX, Ref } from 'react'

/** 折叠阈值：正文超过该字数即收成固定高度，避免一条长文把整条时间线撑长 */
const BODY_COLLAPSE_THRESHOLD = 200

/** 折叠后的高度上限：约 6 行（text-sm + leading-relaxed），超出部分裁掉，底部压渐隐与下箭头 */
const COLLAPSED_BODY_CLASS = 'max-h-36 overflow-hidden'

export interface WeiboCollapsibleBodyProps {
    /** 当前展示的纯文本：只用来数字数，长文全文到货后按全文重新判定 */
    text: string
    /** 正文分段：文字、表情与链接按上游顺序内联渲染 */
    segments: WeiboTimelineSegment[]
    /** 折叠容器的挂载点：主贴正文用它判断是否进入视口，引用块由外层 blockquote 判断故不传 */
    contentRef?: Ref<HTMLParagraphElement>
    /** 正文排版：主贴自带字号行高，引用块沿用外层块级排版 */
    paragraphClassName?: string
    /** 渐隐底色：跟随所在区域，主贴取卡片底，引用块取 muted 底 */
    fadeClassName?: string
    /** 没有正文时的兜底文案：转发体用「原微博不可见」，主贴沿用富文本默认文案 */
    placeholder?: string
}

export function WeiboCollapsibleBody({
    text,
    segments,
    contentRef,
    paragraphClassName,
    fadeClassName,
    placeholder,
}: WeiboCollapsibleBodyProps): JSX.Element {
    const [isExpanded, setIsExpanded] = useState(false)
    /** 正文 id：展开按钮用 aria-controls 指向它，读屏才知道这一下控制的是哪块正文 */
    const bodyId = useId()
    const isCollapsible = text.length > BODY_COLLAPSE_THRESHOLD
    const isCollapsed = isCollapsible && !isExpanded

    const toggleExpanded = useCallback((): void => {
        setIsExpanded((previous) => !previous)
    }, [])

    return (
        <div className="flex flex-col gap-1">
            <div className="relative">
                <p
                    id={bodyId}
                    ref={contentRef}
                    className={cn(
                        'whitespace-pre-wrap wrap-break-word',
                        paragraphClassName,
                        isCollapsed && COLLAPSED_BODY_CLASS,
                    )}
                >
                    <WeiboRichText segments={segments} placeholder={placeholder} />
                </p>
                {/* 渐隐层只做视觉提示：不拦指针，避免盖住最后一行里的正文链接 */}
                {isCollapsed ? (
                    <div
                        aria-hidden="true"
                        className={cn(
                            'pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-linear-to-t to-transparent',
                            fadeClassName,
                        )}
                    ></div>
                ) : null}
            </div>
            {isCollapsible ? (
                <Button
                    variant="ghost"
                    size="sm"
                    className="self-start text-muted-foreground"
                    aria-expanded={isExpanded}
                    aria-controls={bodyId}
                    onClick={toggleExpanded}
                >
                    {isExpanded ? (
                        <>
                            收起
                            <ChevronsUp className="size-3.5" aria-hidden="true" />
                        </>
                    ) : (
                        <>
                            展开全文
                            <ChevronsDown className="size-3.5" aria-hidden="true" />
                        </>
                    )}
                </Button>
            ) : null}
        </div>
    )
}
