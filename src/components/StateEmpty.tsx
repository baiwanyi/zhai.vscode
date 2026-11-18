/**
 * 通用空态占位：统一 Empty 套件的标题、说明、图标与底部操作区组合，空列表与加载中共享同一骨架。
 * 复用约定：结构取 @components/ui 的 empty 与 spinner；图标接受任意可渲染组件，未提供时不渲染图标位；
 * 底部操作区通过 children 传入并由 EmptyContent 承载，调用方不再自带按钮容器。
 * 关键约束：加载态与空态互斥，isLoading 为真时不渲染说明；未传 icon 时用 title 作加载文案，
 * 传了 icon 时图标常驻、加载指示落到标题位并以 title 作可访问名 —— 图标常驻的留白页不必在加载前后换一套骨架；
 * title 可省略（省略或空串时不渲染标题节点），供「只有图标的留白页」使用，此时语义退回转圈自带的标签；
 * 边框与内边距不做预设，由 className 覆盖（虚线边框、卡片内紧凑内边距等），避免各调用点视觉漂移。
 */
import { cn } from 'cn'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import type { ComponentType, JSX, ReactNode } from 'react'

export interface StateEmptyProps {
    /** 空态标题；加载态无业务图标时也用它作加载文案。省略或空串时不渲染标题节点 */
    title?: string
    description?: string
    /** 业务图标：className 由本组件传入（size-5），需要更大尺寸就让图标自行固定，或经 iconClassName 撑开图标位 */
    icon?: ComponentType<{ className?: string }>
    /** 图标位样式：默认 size-12 rounded-2xl，传值用于覆盖尺寸与底色（如留白页的 size-32 rounded-none bg-transparent） */
    iconClassName?: string
    isLoading?: boolean
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
    className,
    children,
}: StateEmptyProps): JSX.Element {
    // 两态共用同一套骨架，只有三处不同：
    // 1) 图标位：加载态必须占位（业务图标或转圈），空态只在调用方给了图标时才有；
    // 2) 标题位：加载态且给了图标时换成转圈并以 title 作可访问名 —— 这类调用是「图标常驻的留白页」，
    //    加载前后各换一套骨架会看起来像两个页面；未给图标时仍用 title 作加载文案；
    // 3) 说明与操作区：仅空态渲染，避免读取过程中同时出现空态措辞；
    // 4) 标题可省略：没有文案时不留空标题节点，加载态语义退回转圈自带的标签。
    const hasTitle = title !== undefined && title.length > 0
    const hasMedia = Icon !== undefined || isLoading
    const isTitleSpinner = isLoading && Icon !== undefined

    return (
        <Empty className={className}>
            <EmptyHeader>
                {hasMedia ? (
                    <EmptyMedia variant="icon" className={cn('size-12 rounded-2xl', iconClassName)}>
                        {/* 无业务图标时这一格只是转圈：有标题文案时语义由 EmptyTitle 承担，
                            自身 aria-hidden 可以避开 Spinner 默认的英文 "Loading" 播报与重复朗读；
                            没有标题文案时保留默认标签，否则这页将没有任何可播报内容 */}
                        {Icon ? (
                            <Icon className="size-5" />
                        ) : (
                            <Spinner className="size-5" aria-hidden={hasTitle} />
                        )}
                    </EmptyMedia>
                ) : null}
                {isTitleSpinner ? (
                    <Spinner className="size-5" aria-label={hasTitle ? title : undefined} />
                ) : hasTitle ? (
                    <EmptyTitle>{title}</EmptyTitle>
                ) : null}
                {isLoading || !description ? null : <EmptyDescription>{description}</EmptyDescription>}
            </EmptyHeader>
            {isLoading || children === undefined || children === null ? null : (
                <EmptyContent>{children}</EmptyContent>
            )}
        </Empty>
    )
}
