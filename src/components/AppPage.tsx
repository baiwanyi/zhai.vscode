/**
 * 页面骨架：流程页统一的「标题与操作 / 说明 / 菜单 / 主体 / 底部操作」组合式插槽，同一文件导出整族组件。
 * 复用约定：结构照 ui/card 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * AppHeader 纵向堆叠：标题与 AppAction 收进同一行，align 决定谁在左（默认 end 为标题在左、动作区在右），
 * AppDescription、AppMenu 等其余子元素按书写顺序整行排在下方；
 * 分区栏、筛选行与徽标行收进 AppMenu，主体滚动走 AppContent 的 isScrollable；
 * AppFooter 默认右对齐，左侧还需常驻控件时由页面分组后传 justify-between。
 * 标题被单行截断时用 AppTitle 的 tooltip 补出完整文案，tooltipSide 只在需避开容器时传；
 * 提示走非受控 Tooltip，指针进入即开，不引入额外状态。
 * 双击 AppTitle 复制整条标题，剪贴板写入走 @shared/utils/clipboard，结果经 sonner 提示。
 * 关键约束：标题行的两列由组件自身定位，页面按 Title → Action → Description → Menu 书写即可，
 * 顺序颠倒不会错位但会丢掉设计意图；AppAction 只放标题行右侧的少量动作，整行控件一律用 AppMenu，
 * 否则会挤压标题；页面不得再自写 h-full + p-3 外壳与顶栏、底栏渐变；
 * tooltip 依赖挂载器统一提供的 TooltipProvider（见 bootstrap），单独渲染时须自行包裹；
 * 双击复制取整条标题文本而非双击选中的词，事件对象在 await 后 currentTarget 会被置空，文本须先取出；
 * 根容器按 h-full 撑满，宿主须给出高度基准，AppContent 的 min-h-0 与 AppFooter 的 shrink-0 是滚动前提。
 */
'use client'

import { cn } from 'cn'
import { toast } from 'sonner'
import { ScrollArea } from '@components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { copyToClipboard } from '@shared/utils/clipboard'
import type { ComponentProps, JSX, MouseEvent } from 'react'

/** 底栏上方的渐变遮罩：滚动内容在按钮下方淡出，只在此处声明一次 */
const FOOTER_MASK_CLASS =
    'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent'

/** 提示气泡与 Button 保持一致：固定暗底亮字，箭头继承同一组变量后自动同色 */
const TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'

function AppPage({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div data-slot="app-page" className={cn('@container flex h-full min-h-0 flex-col p-3', className)} {...props} />
    )
}

/** 标题与操作区的左右位置：end 为标题在左、操作区在右；start 为操作区在左、标题在右 */
type AppHeaderAlign = 'start' | 'end'

interface AppHeaderProps extends ComponentProps<'header'> {
    /** 标题与操作区的左右位置：缺省为 end（标题在左、操作区在右） */
    align?: AppHeaderAlign
}

function AppHeader({ className, align = 'end', ...props }: AppHeaderProps): JSX.Element {
    return (
        <header
            data-slot="app-header"
            data-align={align}
            className={cn(
                'relative flex shrink-0 flex-wrap items-center gap-2 pb-3',
                align === 'start' && 'flex-row-reverse',
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
        const isSuccess = await copyToClipboard(text)
        if (isSuccess) {
            toast.success('已复制标题')
            return
        }
        toast.error('复制失败，请手动选中后复制')
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

function AppContent({ className, isScrollable = false, children, ...props }: AppContentProps): JSX.Element {
    if (!isScrollable) {
        return (
            <div data-slot="app-content" className={cn('min-h-0 flex-1 px-0.5', className)} {...props}>
                {children}
            </div>
        )
    }

    return (
        // Radix 会在 viewport 内插入一层 display:table 的内容壳（内联样式，用于量横向溢出），
        // 表格宽度按内容取，长文本会把整页撑宽、再被隐藏的横向滚动条裁掉；这里用 !important 压掉内联 display。
        <ScrollArea className={cn('min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block!', className)}>
            <div data-slot="app-content" className="flex min-h-full w-full flex-col px-0.5" {...props}>
                {children}
            </div>
        </ScrollArea>
    )
}

function AppFooter({ className, children, ...props }: ComponentProps<'footer'>): JSX.Element {
    return (
        <footer
            data-slot="app-footer"
            className={cn('relative flex w-full items-center justify-end gap-2', FOOTER_MASK_CLASS, className)}
            {...props}
        >
            {children}
        </footer>
    )
}

export { AppAction, AppContent, AppDescription, AppFooter, AppHeader, AppMenu, AppPage, AppTitle }
export type { AppContentProps, AppHeaderAlign, AppHeaderProps, AppTitleProps }
