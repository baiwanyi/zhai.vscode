/**
 * 页面骨架：流程页统一的「标题区 + 主体区 + 底部操作区」组合式插槽，同一文件导出整族七个组件。
 * 复用约定：结构照 ui/card 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件，
 * 页面按 AppHeader / AppContent / AppFooter 顺序组合，分区栏与筛选行收进 AppAction，
 * 主体滚动走 AppContent 的 isScrollable，左侧常驻控件走 AppFooter 的 start。
 * 关键约束：页面不得再自写 h-full + p-3 外壳与底栏渐变，否则间距与滚动收口会逐页漂移；
 * 根容器按 h-full 撑满，宿主须给出高度基准（外层 h-screen 容器或弹性父级），否则滚动区会塌陷；
 * AppContent 的 min-h-0、AppFooter 的 shrink-0 与渐变遮罩是滚动正确性的前提，className 只做布局微调。
 */
import { cn } from 'cn'
import { ScrollArea } from '@components/ui/scroll-area'
import type { ComponentProps, JSX, ReactNode } from 'react'

/** 底栏上方的渐变遮罩：滚动内容在按钮下方淡出，只在此处声明一次 */
const FOOTER_MASK_CLASS =
    'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent'

function AppPage({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-page"
            className={cn('@container flex h-full min-h-0 flex-col gap-3 p-3', className)}
            {...props}
        />
    )
}

function AppHeader({ className, ...props }: ComponentProps<'header'>): JSX.Element {
    return <header data-slot="app-header" className={cn('flex shrink-0 flex-col gap-2', className)} {...props} />
}

function AppTitle({ className, ...props }: ComponentProps<'h1'>): JSX.Element {
    return <h1 data-slot="app-title" className={cn('truncate font-heading text-lg', className)} {...props} />
}

function AppDescription({ className, ...props }: ComponentProps<'p'>): JSX.Element {
    return <p data-slot="app-description" className={cn('text-muted-foreground text-xs', className)} {...props} />
}

function AppAction({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-action" className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
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
        <ScrollArea className={cn('min-h-0 flex-1', className)}>
            <div data-slot="app-content" className="flex min-h-full flex-col p-0.5" {...props}>
                {children}
            </div>
        </ScrollArea>
    )
}

interface AppFooterProps extends ComponentProps<'footer'> {
    /** 左侧常驻内容：生成方式开关、状态提示等非按钮控件 */
    start?: ReactNode
}

function AppFooter({ className, start, children, ...props }: AppFooterProps): JSX.Element {
    return (
        <footer
            data-slot="app-footer"
            className={cn(
                'relative flex shrink-0 items-center gap-1.5 pt-2',
                start === undefined ? 'justify-end' : 'justify-between',
                FOOTER_MASK_CLASS,
                className,
            )}
            {...props}
        >
            {start !== undefined ? <div className="flex shrink-0 items-center gap-1.5">{start}</div> : null}
            {children}
        </footer>
    )
}

export { AppAction, AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle }
export type { AppContentProps, AppFooterProps }
