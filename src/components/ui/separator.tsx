/**
 * 分隔线：在视觉上区隔内容分区。
 * 复用约定：基于 radix-ui 构建，方向与厚度由主题令牌控制。
 * 关键约束：纯装饰时保持 decorative 语义，参与结构语义时须显式声明，避免屏幕阅读器误读分组。
 */
import * as React from 'react'
import { cn } from 'cn'
import { Separator as SeparatorPrimitive } from 'radix-ui'

function Separator({
    className,
    orientation = 'horizontal',
    decorative = true,
    ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
    return (
        <SeparatorPrimitive.Root
            data-slot="separator"
            decorative={decorative}
            orientation={orientation}
            className={cn(
                'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
                className,
            )}
            {...props}
        />
    )
}

export { Separator }
