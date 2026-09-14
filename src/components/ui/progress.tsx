/**
 * 进度条：表达确定性任务的完成比例。
 * 复用约定：基于 radix-ui 构建，样式经 cn 合并主题令牌。
 * 关键约束：进度值取值 0-100 且必须提供可访问名称（外部标签或 aria-label）；不确定进度应改用 Spinner。
 */
'use client'

import * as React from 'react'
import { cn } from 'cn'
import { Progress as ProgressPrimitive } from 'radix-ui'

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            className={cn('relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted', className)}
            {...props}
        >
            <ProgressPrimitive.Indicator
                data-slot="progress-indicator"
                className="size-full flex-1 bg-primary transition-all"
                style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
            />
        </ProgressPrimitive.Root>
    )
}

export { Progress }
