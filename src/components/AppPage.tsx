/**
 * 页面骨架：流程页统一的「标题与操作 / 说明 / 菜单 / 主体 / 底部操作」组合式插槽，同一文件导出整族组件。
 * 复用约定：结构照 ui/card 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * AppHeader 为两列网格：标题在左、AppAction 在右上同一行，AppDescription 与 AppMenu 各占一整行；
 * 分区栏、筛选行与徽标行收进 AppMenu，主体滚动走 AppContent 的 isScrollable；
 * AppFooter 默认右对齐，左侧还需常驻控件时由页面分组后传 justify-between。
 * 关键约束：标题行的两列由组件自身定位，页面按 Title → Action → Description → Menu 书写即可，
 * 顺序颠倒不会错位但会丢掉设计意图；AppAction 只放标题行右侧的少量动作，整行控件一律用 AppMenu，
 * 否则会挤压标题；页面不得再自写 h-full + p-3 外壳与底栏渐变；
 * 根容器按 h-full 撑满，宿主须给出高度基准，AppContent 的 min-h-0 与 AppFooter 的 shrink-0 是滚动前提。
 */
import { cn } from 'cn'
import { ScrollArea } from '@components/ui/scroll-area'
import type { ComponentProps, JSX } from 'react'

/** 底栏上方的渐变遮罩：滚动内容在按钮下方淡出，只在此处声明一次 */
const FOOTER_MASK_CLASS =
    'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent'

function AppPage({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div data-slot="app-page" className={cn('@container flex h-full min-h-0 flex-col p-3', className)} {...props} />
    )
}

function AppHeader({ className, ...props }: ComponentProps<'header'>): JSX.Element {
    return (
        <header
            data-slot="app-header"
            className={cn('grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-2', className)}
            {...props}
        />
    )
}

function AppTitle({ className, ...props }: ComponentProps<'h1'>): JSX.Element {
    return (
        <h1
            data-slot="app-title"
            className={cn('col-start-1 min-w-0 truncate font-heading text-lg', className)}
            {...props}
        />
    )
}

function AppDescription({ className, ...props }: ComponentProps<'p'>): JSX.Element {
    return (
        <p
            data-slot="app-description"
            className={cn('col-span-full text-muted-foreground text-xs', className)}
            {...props}
        />
    )
}

function AppAction({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-action"
            className={cn('col-start-2 flex flex-wrap items-center justify-end gap-2', className)}
            {...props}
        />
    )
}

function AppMenu({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-menu"
            className={cn('col-span-full flex flex-wrap items-center gap-2', className)}
            {...props}
        />
    )
}

interface AppContentProps extends ComponentProps<'div'> {
    /** 由本组件承担纵向滚动：true 时内容包进 ScrollArea，滚动条与焦点环留白一并统一 */
    isScrollable?: boolean
}

function AppContent({ className, isScrollable = false, children, ...props }: AppContentProps): JSX.Element {
    if (!isScrollable) {
        return (
            <div data-slot="app-content" className={cn('min-h-0 flex-1', className)} {...props}>
                {children}
            </div>
        )
    }

    return (
        // Radix 会在 viewport 内插入一层 display:table 的内容壳（内联样式，用于量横向溢出），
        // 表格宽度按内容取，长文本会把整页撑宽、再被隐藏的横向滚动条裁掉；这里用 !important 压掉内联 display。
        <ScrollArea className={cn('min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block!', className)}>
            <div data-slot="app-content" className="flex min-h-full w-full flex-col p-0.5" {...props}>
                {children}
            </div>
        </ScrollArea>
    )
}

function AppFooter({ className, children, ...props }: ComponentProps<'footer'>): JSX.Element {
    return (
        <footer
            data-slot="app-footer"
            className={cn('relative flex shrink-0 items-center justify-end gap-1.5 pt-2', FOOTER_MASK_CLASS, className)}
            {...props}
        >
            {children}
        </footer>
    )
}

export { AppAction, AppContent, AppDescription, AppFooter, AppHeader, AppMenu, AppPage, AppTitle }
export type { AppContentProps }
