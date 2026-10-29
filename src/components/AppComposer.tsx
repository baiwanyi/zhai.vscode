/**
 * 输入卡片骨架：整张卡片分「顶栏 / 内容区（输入与底部操作）」，与 AppPage 配套，对话与生图共用同一套两层底色。
 * 复用约定：结构照 AppPage 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * 生成态光晕取同目录 ComposerGlow，挂在根容器上覆盖整张卡片，调用方不必在各页面重复挂装饰层；
 * 输入控件本身不由骨架提供，AppComposerInput 只作输入区槽位，底色与留白由 AppComposerContent 提供。
 * 顶栏在内容区之上、同属卡片：AppComposerCommands 放命令 / 引用等入口并按内容取宽，
 * AppComposerToolbar 紧随其后撑满剩余宽度。
 * 关键约束：外壳是两层自定义底色——外层 AppComposer 为 bg-composer，内层 AppComposerContent 为
 * bg-composer-input；ui/card 不支持双层底色与内容区提亮，故沿用骨架写法而不套 Card；
 * 光晕必须挂在卡片外侧的兄弟层、根容器自带 isolate，否则会被不透明卡片盖住或沉到页面背景之后；
 * 底部操作分左右两组：Actions 撑满剩余宽度、Buttons 按内容收缩并贴着右边缘，
 * 因此 Actions / Toolbar 必须带 flex-1、Commands / Buttons 必须带 shrink-0；
 * 两组之间留 gap-2（组内 gap-0.5 只作用于按钮之间），撑满一组、收缩一组，间距才稳定；
 * 各层只用 padding 划分、不设 gap：外层卡片的 p-1.5 与内层内容区的 p-3 分层提供留白，页面不再额外补 px。
 */
import { cn } from 'cn'
import { ComposerGlow } from './ComposerGlow'
import type { ComponentProps, JSX } from 'react'

/** 按钮组共用排版：按内容排布、窄容器内自行换行；是否撑满剩余宽度由各部件附加 flex-1 / shrink-0 决定 */
const GROUP_ROW_CLASS = 'flex min-w-0 flex-wrap items-center gap-0.5'

interface AppComposerProps extends ComponentProps<'div'> {
    /** 生成态：只驱动覆盖整张卡片的光晕，卡片内容与交互不受影响 */
    isGenerating?: boolean
}

function AppComposer({ className, isGenerating = false, children, ...props }: AppComposerProps): JSX.Element {
    return (
        // isolate 给光晕划定层叠边界：-z-10 只落在卡片之下，不会沉到页面背景后面
        <div
            data-slot="app-composer"
            className={cn(
                'relative isolate w-full flex min-w-0 flex-col flex-1 rounded-2xl bg-composer p-1.5',
                className,
            )}
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
            className={cn('flex min-w-0 flex-col flex-1 rounded-xl bg-composer-input p-3', className)}
            {...props}
        />
    )
}

function AppComposerHeader({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div
            data-slot="app-composer-header"
            className={cn('flex w-full flex-wrap items-center gap-2 p-1', className)}
            {...props}
        />
    )
}

function AppComposerCommands({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-composer-commands" className={cn(GROUP_ROW_CLASS, 'shrink-0', className)} {...props} />
}

function AppComposerToolbar({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-composer-toolbar" className={cn(GROUP_ROW_CLASS, 'flex-1', className)} {...props} />
}

function AppComposerInput({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-composer-input" className={cn('min-w-0', className)} {...props} />
}

function AppComposerFooter({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return (
        <div data-slot="app-composer-footer" className={cn('flex w-full items-center gap-2', className)} {...props} />
    )
}

function AppComposerActions({ className, ...props }: ComponentProps<'div'>): JSX.Element {
    return <div data-slot="app-composer-actions" className={cn(GROUP_ROW_CLASS, 'flex-1', className)} {...props} />
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
    AppComposerCommands,
    AppComposerContent,
    AppComposerFooter,
    AppComposerHeader,
    AppComposerInput,
    AppComposerToolbar,
}
export type { AppComposerProps }
