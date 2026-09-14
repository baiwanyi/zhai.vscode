/**
 * 悬停卡片：鼠标停留时展示的富信息预览浮层。
 * 复用约定：基于 radix-ui 构建，样式经 cn 合并主题令牌。
 * 关键约束：仅承载补充信息，禁止放入必须点击才能完成的控件；触屏场景下应提供替代入口。
 */
import * as React from 'react'
import { cn } from 'cn'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
    return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
    return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
    className,
    align = 'center',
    sideOffset = 4,
    ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
    return (
        <HoverCardPrimitive.Portal data-slot="hover-card-portal">
            <HoverCardPrimitive.Content
                data-slot="hover-card-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    'z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                    className,
                )}
                {...props}
            />
        </HoverCardPrimitive.Portal>
    )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
