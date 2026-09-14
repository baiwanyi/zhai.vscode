/**
 * 标记：用于时间线、分组标题或状态分段的小型标注，可带图标与变体色。
 * 复用约定：基于 radix-ui 的 Slot 与 cva 变体实现，样式经 cn 合并主题令牌。
 * 关键约束：图标经 MarkerIcon 传入以复用统一尺寸；变体语义由 markerVariants 定义，禁止覆盖配色。
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'

const markerVariants = cva(
    "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
    {
        variants: {
            variant: {
                default: '',
                separator:
                    'before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border',
                border: 'border-b border-border pb-2',
            },
        },
    },
)

function Marker({
    className,
    variant = 'default',
    asChild = false,
    ...props
}: React.ComponentProps<'div'> &
    VariantProps<typeof markerVariants> & {
        asChild?: boolean
    }) {
    const Comp = asChild ? Slot.Root : 'div'

    return (
        <Comp
            data-slot="marker"
            data-variant={variant}
            className={cn(markerVariants({ variant, className }))}
            {...props}
        />
    )
}

function MarkerIcon({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-icon"
            aria-hidden="true"
            className={cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
            {...props}
        />
    )
}

function MarkerContent({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-content"
            className={cn(
                'min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
                className,
            )}
            {...props}
        />
    )
}

export { Marker, MarkerIcon, MarkerContent, markerVariants }
