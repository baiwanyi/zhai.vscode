/**
 * 提示条：以静态内联方式呈现信息、警告与错误说明，不产生浮层。
 * 复用约定：变体由 cva 定义并复用主题令牌，图标取自 lucide-react。
 * 关键约束：仅用于展示，不承载需要点击的操作；状态语义应通过 variant 表达，禁止覆盖配色。
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

const alertVariants = cva(
    "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: 'bg-card text-card-foreground',
                destructive:
                    'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    },
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
    return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-title"
            className={cn(
                'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
                className,
            )}
            {...props}
        />
    )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-description"
            className={cn(
                'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
                className,
            )}
            {...props}
        />
    )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="alert-action" className={cn('absolute top-2 right-2', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
