/**
 * 表单标签：为输入控件提供可点击的文本标识。
 * 复用约定：基于 radix-ui 构建，样式经 cn 合并主题令牌。
 * 关键约束：htmlFor 必须与控件 id 对应，否则点击标签无法聚焦控件；禁止用普通 span 替代以维持无障碍语义。
 */
import * as React from 'react'
import { cn } from 'cn'
import { Label as LabelPrimitive } from 'radix-ui'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
    return (
        <LabelPrimitive.Root
            data-slot="label"
            className={cn(
                'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                className,
            )}
            {...props}
        />
    )
}

export { Label }
