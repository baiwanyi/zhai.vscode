/**
 * 输入卡片骨架：把「工具栏 / 输入区 / 底部操作」收成与 AppPage 配套的槽位族，对话与生图共用同一套两层底色。
 * 复用约定：结构照 AppPage 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * 生成态光晕取同目录 ComposerGlow，由 isGenerating 驱动，调用方不必在各页面重复挂装饰层；
 * 输入控件本身不由骨架提供，AppComposerInput 只给内容区的底色、圆角与内留白。
 * 关键约束：外壳是两层自定义底色（bg-composer / bg-composer-input，定义在 globals.css），
 * ui/card 不支持双层底色与内容区提亮，故沿用骨架写法而不套 Card；
 * 光晕必须挂在卡片外侧的兄弟层、根容器自带 isolate，否则会被不透明卡片盖住或沉到页面背景之后；
 * 底部操作分左右两组：Actions 按内容自适应、Buttons 靠右收缩，中间留白由 justify-between 产生，
 * 因此 Actions 不得加 flex-1，否则两组会被拉成等宽而丢掉设计意图；
 * 横向内边距由页面 AppFooter 统一提供，此处不再自带 px，否则会与骨架的 px-3 叠加成双重缩进。
 */
import { cn } from 'cn'
import { ComposerGlow } from './ComposerGlow'
import type { ComponentProps, JSX } from 'react'

interface AppComposerProps extends ComponentProps<'div'> {
    /** 生成态：只驱动卡片外侧光晕，卡片内容与交互不受影响 */
    isGenerating?: boolean
}

function AppComposer({ className, isGenerating = false, children, ...props }: AppComposerProps): JSX.Element {
    return (
        <div
            data-slot="app-composer"
            className={cn('relative isolate flex w-full min-w-0 flex-1 flex-col', className)}
            {...props}
        >
            <ComposerGlow isGenerating={isGenerating} />
            {children}
        </div>
    )
}

function AppComposerContent({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-content"
            className={cn('flex min-w-0 flex-col gap-0.5 rounded-2xl bg-composer p-1.5', className)}
            {...props}
        />
    )
}

function AppComposerToolbar({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-toolbar"
            className={cn('flex w-full flex-wrap items-center gap-0.5 px-0.5 pt-0.5', className)}
            {...props}
        />
    )
}

function AppComposerInput({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-input"
            className={cn('min-w-0 rounded-xl bg-composer-input p-3', className)}
            {...props}
        />
    )
}

function AppComposerFooter({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-footer"
            className={cn('flex w-full items-center justify-between gap-2 px-0.5 pt-0.5', className)}
            {...props}
        />
    )
}

function AppComposerActions({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-actions"
            className={cn('flex min-w-0 flex-wrap items-center gap-0.5', className)}
            {...props}
        />
    )
}

function AppComposerButtons({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-buttons"
            className={cn('flex shrink-0 items-center gap-0.5', className)}
            {...props}
        />
    )
}

export {
    AppComposer,
    AppComposerActions,
    AppComposerButtons,
    AppComposerContent,
    AppComposerFooter,
    AppComposerInput,
    AppComposerToolbar,
}
export type { AppComposerProps }
