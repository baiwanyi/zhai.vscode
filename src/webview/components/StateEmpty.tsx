/**
 * 通用空态占位：统一 Empty 套件的标题、说明、图标与底部操作区组合，空列表与加载中共享同一骨架。
 * 复用约定：结构取 @components/ui 的 empty 与 spinner；图标接受任意可渲染组件，未提供时不渲染图标位；
 * 底部操作区通过 children 传入并由 EmptyContent 承载，调用方不再自带按钮容器。
 * 关键约束：加载态与空态互斥，isLoading 为真时不渲染标题与说明，防止「还没有」与「正在读取」被同时读出；
 * 边框与内边距不做预设，由 className 覆盖（虚线边框、卡片内紧凑内边距等），避免各调用点视觉漂移。
 */
import { cn } from 'cn'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import type { JSX, ReactNode } from 'react'

export interface StateEmptyProps {
    title: string
    description?: string
    icon?: (props: { className?: string }) => ReactNode
    /** 图标位样式：引导型空态可传 size-12 rounded-2xl，普通空态留空 */
    iconClassName?: string
    isLoading?: boolean
    /** 加载中文案，默认「正在读取…」 */
    loadingLabel?: string
    className?: string
    /** 底部操作区：按钮组由 EmptyContent 承载，不需要时省略 */
    children?: ReactNode
}

export function StateEmpty({
    title,
    description,
    icon: Icon,
    iconClassName,
    isLoading = false,
    loadingLabel = '正在读取…',
    className,
    children,
}: StateEmptyProps): JSX.Element {
    if (isLoading) {
        return (
            <Empty className={className}>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className={cn('size-12 rounded-2xl', iconClassName)}>
                        <Spinner />
                    </EmptyMedia>
                    <EmptyTitle>{loadingLabel}</EmptyTitle>
                </EmptyHeader>
            </Empty>
        )
    }

    return (
        <Empty className={className}>
            <EmptyHeader>
                {Icon ? (
                    <EmptyMedia variant="icon" className={iconClassName}>
                        <Icon className="size-5" />
                    </EmptyMedia>
                ) : null}
                <EmptyTitle>{title}</EmptyTitle>
                {description ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            {children ? <EmptyContent>{children}</EmptyContent> : null}
        </Empty>
    )
}
