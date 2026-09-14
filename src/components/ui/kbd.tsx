/**
 * 快捷键提示：以键帽样式展示按键或组合键。
 * 复用约定：纯样式组件，类名经 cn 合并主题令牌。
 * 关键约束：仅用于展示，不绑定任何键位逻辑；实际快捷键需在命令注册处声明以保持一致。
 */
import { cn } from 'cn'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
                className,
            )}
            {...props}
        />
    )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
    return <kbd data-slot="kbd-group" className={cn('inline-flex items-center gap-1', className)} {...props} />
}

export { Kbd, KbdGroup }
