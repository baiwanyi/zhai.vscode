/**
 * 可调面板：在容器内划分可拖动调整的分区。
 * 复用约定：基于 react-resizable-panels 构建，拖拽图标取自 lucide-react，样式经 cn 合并。
 * 关键约束：Panel 必须置于 PanelGroup 内；尺寸以百分比表达并设置 minSize 防止被拖拽至不可用宽度。
 */
'use client'

import { cn } from 'cn'
import * as ResizablePrimitive from 'react-resizable-panels'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
    return (
        <ResizablePrimitive.Group
            data-slot="resizable-panel-group"
            className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
            {...props}
        />
    )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
    return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
    withHandle,
    className,
    ...props
}: ResizablePrimitive.SeparatorProps & {
    withHandle?: boolean
}) {
    return (
        <ResizablePrimitive.Separator
            data-slot="resizable-handle"
            className={cn(
                'relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
                className,
            )}
            {...props}
        >
            {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
        </ResizablePrimitive.Separator>
    )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
