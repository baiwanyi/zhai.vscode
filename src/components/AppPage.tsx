/**
 * 页面骨架：流程页统一的「标题与操作 / 说明 / 菜单 / 主体 / 底部操作」组合式插槽，同一文件导出整族组件。
 * 复用约定：结构照 ui/card 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * AppHeader 纵向堆叠：标题与 AppAction 收进同一行，align 决定二者关系（默认 end 为标题在左、动作区在右；
 * start 为动作区夹持标题，首个动作区在左、第二个在右），AppDescription、AppMenu 等其余子元素按书写顺序整行排在下方；
 * 分区栏、筛选行与徽标行收进 AppMenu，主体滚动走 AppContent 的 isScrollable；
 * AppFooter 默认右对齐，左侧还需常驻控件时由页面分组后传 justify-between。
 * 底栏渐变遮罩按需挂载：AppContent 量滚动容器的偏移与高度，只有「内容溢出且未到底」时才给 AppFooter 加
 * FOOTER_MASK_CLASS —— 内容不足一屏或已滚到底时遮罩会在底栏上沿投出一条无意义的渐变。
 * 标题被单行截断时用 AppTitle 的 tooltip 补出完整文案，tooltipSide 只在需避开容器时传；
 * 提示走非受控 Tooltip，指针进入即开，不引入额外状态。
 * 双击 AppTitle 复制整条标题，剪贴板写入走 @shared/utils/clipboard，结果经 sonner 提示。
 * 关键约束：标题行的列位由组件自身定位，页面按 Title → Action → Description → Menu 书写即可，
 * 顺序颠倒不会错位但会丢掉设计意图；AppAction 只放标题行的少量动作，整行控件一律用 AppMenu，
 * 否则会挤压标题；start 下最多两段动作区——三列网格只有左右两个动作位，第三段会被挤到下一行；
 * 页面不得再自写 h-full + p-3 外壳与顶栏、底栏渐变；
 * tooltip 依赖挂载器统一提供的 TooltipProvider（见 bootstrap），单独渲染时须自行包裹；
 * 双击复制取整条标题文本而非双击选中的词，事件对象在 await 后 currentTarget 会被置空，文本须先取出；
 * 根容器按 h-full 撑满，宿主须给出高度基准，AppContent 的 min-h-0 与 AppFooter 的 shrink-0 是滚动前提。
 */
'use client'

import { cn } from 'cn'
import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '@components/ui/scroll-area'
import { copyWithToast } from '@shared/utils/clipboard'
import { preventContextMenu } from '@shared/utils/dom'
import { SCROLL_VIEWPORT_SELECTOR } from '@shared/utils/scrollArea'
import { TOOLTIP_CLASS, Tooltip, TooltipContent, TooltipTrigger } from './Tooltip'
import type { ComponentProps, JSX, MouseEvent, RefObject } from 'react'

/** 底栏上方的渐变遮罩：滚动内容在按钮下方淡出，只在此处声明一次 */
const FOOTER_MASK_CLASS =
    'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent'

/** 滚动容器的测量精度：亚像素布局会让「恰好填满」被判成溢出、「恰好到底」被判成未到底 */
const SCROLL_TOLERANCE = 1

/** 底栏遮罩的可见性：AppContent 测量后写入，AppFooter 读取后决定是否挂渐变 */
interface FooterMaskState {
    isVisible: boolean
    setIsVisible: (visible: boolean) => void
}

/**
 * 缺省为 null：页面未套 AppPage 时保持原行为（始终显示遮罩），不至于因漏包 Provider 而丢样式。
 * 关键约束：一份状态对应一个 AppPage，页面内只应有一个 isScrollable 的 AppContent；
 * 同时挂两个可滚动区时后测量者会覆盖前者（当前所有页面都是单滚动区，不构成问题）。
 */
const FooterMaskContext = createContext<FooterMaskState | null>(null)

function AppPage({ className, onContextMenu = preventContextMenu, ...props }: ComponentProps<'div'>): JSX.Element {
    // 默认不挂遮罩：首帧还不知道内容是否溢出，先按「不需要」渲染，避免无溢出时先闪一下渐变
    const [isFooterMaskVisible, setIsFooterMaskVisible] = useState(false)
    const footerMask = useMemo<FooterMaskState>(
        () => ({ isVisible: isFooterMaskVisible, setIsVisible: setIsFooterMaskVisible }),
        [isFooterMaskVisible],
    )
    return (
        <FooterMaskContext value={footerMask}>
            <div
                data-slot="app-page"
                className={cn('@container flex h-full min-h-0 flex-col', className)}
                onContextMenu={onContextMenu}
                {...props}
            />
        </FooterMaskContext>
    )
}

/** 标题与操作区的左右位置：end 为标题在左、操作区在右；start 为操作区夹持标题（首个在左、第二个在右） */
type AppHeaderAlign = 'start' | 'end'

interface AppHeaderProps extends ComponentProps<'header'> {
    /** 标题与操作区的左右位置：缺省为 end（标题在左、操作区在右） */
    align?: AppHeaderAlign
}

/** start 对齐的三列网格：标题钉在第 2 列第 1 行，动作区由 grid 自动放置（首个落左列、第二个落右列），
 *  标题与动作区之外的子元素（说明、菜单、摘要）一律跨满整行 */
const HEADER_START_CLASS = [
    'grid grid-cols-[auto_minmax(0,1fr)_auto]',
    '[&>[data-slot=app-title]]:col-start-2 [&>[data-slot=app-title]]:row-start-1',
    '[&>*:not([data-slot=app-title]):not([data-slot=app-action])]:col-span-full',
].join(' ')

function AppHeader({ className, align = 'end', ...props }: AppHeaderProps): JSX.Element {
    return (
        <header
            data-slot="app-header"
            data-align={align}
            className={cn(
                'relative shrink-0 items-center gap-2 p-3',
                align === 'start' ? HEADER_START_CLASS : 'flex flex-wrap',
                className,
            )}
            {...props}
        />
    )
}

interface AppTitleProps extends ComponentProps<'h1'> {
    /** 悬停提示文案：标题单行截断时用完整文案补充，未传则不引入任何提示层 */
    tooltip?: string
    /** 提示框方位，省略时由 Radix 按可用空间自动选择 */
    tooltipSide?: ComponentProps<typeof TooltipContent>['side']
}

function AppTitle({ className, tooltip, tooltipSide, children, onDoubleClick, ...props }: AppTitleProps): JSX.Element {
    /** 双击复制整条标题：截断后的标题选不全，复制取整条文本，结果用提示告知 */
    async function handleDoubleClick(event: MouseEvent<HTMLHeadingElement>): Promise<void> {
        // 双击会顺手选中一个词，先清掉选区，避免复制后标题仍带高亮
        window.getSelection()?.removeAllRanges()
        // 事件对象在 await 之后 currentTarget 会被置空，文本必须先取出
        const text = event.currentTarget.textContent?.trim() ?? ''
        onDoubleClick?.(event)
        if (text.length === 0) {
            return
        }
        await copyWithToast(text, '已复制标题')
    }

    const title = (
        <h1
            data-slot="app-title"
            className={cn('min-w-0 flex-1 cursor-pointer truncate font-heading text-lg select-none', className)}
            onDoubleClick={(event) => void handleDoubleClick(event)}
            {...props}
        >
            {children}
        </h1>
    )

    if (!tooltip) {
        return title
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{title}</TooltipTrigger>
            <TooltipContent side={tooltipSide} className={TOOLTIP_CLASS}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    )
}

function AppDescription({ className, ...props }: ComponentProps<'p'>): JSX.Element {
    return (
        <p data-slot="app-description" className={cn('w-full text-muted-foreground text-xs', className)} {...props} />
    )
}

function AppAction({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-action"
            className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2', className)}
            {...props}
        />
    )
}

function AppMenu({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-menu" className={cn('flex w-full flex-wrap items-center gap-2', className)} {...props} />
}

interface AppContentProps extends ComponentProps<'div'> {
    /** 由本组件承担纵向滚动：true 时内容包进 ScrollArea，滚动条与焦点环留白一并统一 */
    isScrollable?: boolean
}

/**
 * 底栏遮罩联动：测量滚动容器「是否溢出且未到底」，把结论写回 AppPage 的共享状态。
 * 关键约束：依赖里只放稳定的 setter —— 若把整个 Context 值放进来，遮罩每次开关都会重建监听；
 * 滚动容器找不到时保持当前状态（退化为无遮罩），不按猜测给值。
 */
function useFooterMaskSync(isScrollable: boolean, scrollRef: RefObject<HTMLDivElement | null>): void {
    const footerMask = use(FooterMaskContext)
    const setIsFooterMaskVisible = footerMask?.setIsVisible

    useEffect(() => {
        if (setIsFooterMaskVisible === undefined) {
            return
        }
        if (!isScrollable) {
            setIsFooterMaskVisible(false)
            return
        }
        // 选择器取 @shared/utils/scrollArea：与下方覆盖 display 的样式、续载哨兵共用同一份，不留两套口径
        const viewport = scrollRef.current?.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR)
        if (viewport === null || viewport === undefined) {
            return
        }
        const update = (): void => {
            const { clientHeight, scrollHeight, scrollTop } = viewport
            const hasOverflow = scrollHeight - clientHeight > SCROLL_TOLERANCE
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_TOLERANCE
            setIsFooterMaskVisible(hasOverflow && !isAtBottom)
        }
        update()
        viewport.addEventListener('scroll', update, { passive: true })
        // 容器尺寸（窗口缩放、侧栏折叠）与内容高度（列表追加、折叠展开）变化都要重算；
        // ResizeObserver 在部分宿主与测试环境缺失：缺就只保留滚动联动，不能在这里抛错拖垮整棵骨架
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        if (observer !== null) {
            observer.observe(viewport)
            const contentShell = viewport.firstElementChild
            if (contentShell !== null) {
                observer.observe(contentShell)
            }
        }
        return (): void => {
            viewport.removeEventListener('scroll', update)
            observer?.disconnect()
        }
    }, [isScrollable, scrollRef, setIsFooterMaskVisible])
}

function AppContent({ className, isScrollable = false, children, ...props }: AppContentProps): JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null)
    useFooterMaskSync(isScrollable, scrollRef)

    if (!isScrollable) {
        return (
            <div data-slot="app-content" className={cn('min-h-0 flex-1 px-3', className)} {...props}>
                {children}
            </div>
        )
    }

    return (
        // Radix 会在 viewport 内插入一层 display:table 的内容壳（内联样式，用于量横向溢出），
        // 表格宽度按内容取，长文本会把整页撑宽、再被隐藏的横向滚动条裁掉；这里用 !important 压掉内联 display。
        <ScrollArea
            ref={scrollRef}
            className={cn('min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!', className)}
        >
            <div data-slot="app-content" className="flex min-h-full w-full flex-col px-3" {...props}>
                {children}
            </div>
        </ScrollArea>
    )
}

function AppFooter({ className, children, ...props }: ComponentProps<'footer'>): JSX.Element {
    const footerMask = use(FooterMaskContext)
    // 未套 AppPage（Context 缺位）时保持旧行为：始终显示遮罩
    const isMaskVisible = footerMask === null || footerMask.isVisible
    return (
        <footer
            data-slot="app-footer"
            className={cn(
                'relative flex w-full items-center justify-end gap-2 px-3 pb-2',
                isMaskVisible ? FOOTER_MASK_CLASS : null,
                className,
            )}
            {...props}
        >
            {children}
        </footer>
    )
}

export { AppAction, AppContent, AppDescription, AppFooter, AppHeader, AppMenu, AppPage, AppTitle }
export type { AppContentProps, AppHeaderAlign, AppHeaderProps, AppTitleProps }
