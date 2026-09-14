/**
 * 书写方向上下文：为子树提供 LTR/RTL 环境，驱动组件内部的方向感知布局。
 * 复用约定：基于 radix-ui 构建，方向值经 useDirection 读取。
 * 关键约束：须在应用根部包裹一次，避免局部嵌套导致方向不一致；方向变化时不要缓存依赖方向的测量结果。
 */
'use client'

import * as React from 'react'
import { Direction } from 'radix-ui'

function DirectionProvider({
    dir,
    direction,
    children,
}: React.ComponentProps<typeof Direction.DirectionProvider> & {
    direction?: React.ComponentProps<typeof Direction.DirectionProvider>['dir']
}) {
    return <Direction.DirectionProvider dir={direction ?? dir}>{children}</Direction.DirectionProvider>
}

const useDirection = Direction.useDirection

export { DirectionProvider, useDirection }
