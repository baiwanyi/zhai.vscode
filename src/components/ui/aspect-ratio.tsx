/**
 * 宽高比容器：按固定比例约束子内容尺寸，常用于封面图与视频占位。
 * 复用约定：基于 radix-ui 构建，样式经 cn 合并。
 * 关键约束：ratio 以数值传入（如 16 / 9）；容器不负责内容裁剪，溢出行为由子元素自行声明。
 */
'use client'

import { AspectRatio as AspectRatioPrimitive } from 'radix-ui'

function AspectRatio({ ...props }: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
    return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />
}

export { AspectRatio }
