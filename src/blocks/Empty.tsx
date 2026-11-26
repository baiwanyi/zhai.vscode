/**
 * 通用空态占位：统一 Empty 套件的标题、说明、图标与底部操作区组合，空列表与加载中共享同一骨架。
 * 复用约定：结构取 @components/ui 的 empty 与 spinner，图标位默认取本模块的 BrandLogo（项目 icon.svg）；
 * 图标接受任意可渲染组件，未提供时一律用项目 logo 占位，图标位不会空缺；
 * 底部操作区通过 children 传入并由 EmptyContent 承载，调用方不再自带按钮容器。
 * 关键约束：加载态与空态互斥，isLoading 为真时不渲染说明；
 * 标题位在加载态固定为「转圈 + title」同行，文案照常可读，转圈自身隐藏以免重复播报；
 * 未传 icon 时图标位是项目 logo，尺寸用 size-32 且无底色，避免被紧凑图标位的 48px 方块裁掉；
 * title 可省略（省略或空串时不渲染标题节点），供「只有图标的留白页」使用；
 * 边框与内边距不做预设，由 className 覆盖（虚线边框、卡片内紧凑内边距等），避免各调用点视觉漂移。
 */
import { cn } from 'cn'
import { Empty as UiEmpty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import { Image } from '@webview/components/Image'
import logoIcon from '@resources/icon.svg'
import type { ComponentType, JSX, ReactNode } from 'react'

export interface EmptyProps {
    /** 空态标题；加载态无业务图标时也用它作加载文案。省略或空串时不渲染标题节点 */
    title?: string
    description?: string
    /** 业务图标：className 由本组件传入（size-5）；省略时图标位用项目 logo，需要更大尺寸就经 iconClassName 撑开 */
    icon?: ComponentType<{ className?: string }>
    /** 图标位样式：业务图标默认 size-12 rounded-2xl，默认 logo 默认 size-32 rounded-none bg-transparent，传值整组覆盖 */
    iconClassName?: string
    isLoading?: boolean
    className?: string
    /** 底部操作区：按钮组由 EmptyContent 承载，不需要时省略 */
    children?: ReactNode
}

export function Empty({
    title,
    description,
    icon: Icon,
    iconClassName,
    isLoading = false,
    className,
    children,
}: EmptyProps): JSX.Element {
    // 两态共用同一套骨架，只有三处不同：
    // 1) 图标位：始终渲染，未传 icon 时用项目 logo；两种图标来源尺寸差异大，
    //    样式分开给默认值，避免 logo 被紧凑图标位的方块裁掉；
    // 2) 标题位：加载态固定为「转圈 + 文案」同一行，文案照常可读；
    // 3) 说明与操作区：仅空态渲染，避免读取过程中同时出现空态措辞；
    // 4) 标题可省略：没有文案时不留空标题节点，加载态语义退回转圈自带的标签。
    const hasTitle = title !== undefined && title.length > 0
    const mediaClassName =
        Icon === undefined ? cn('size-32 rounded-none bg-transparent', iconClassName) : cn('size-12 rounded-2xl', iconClassName)

    return (
        <UiEmpty className={className}>
            <EmptyHeader>
                <EmptyMedia variant="icon" className={mediaClassName}>
                    {Icon === undefined ? <BrandLogo /> : <Icon className="size-5" />}
                </EmptyMedia>
                {isLoading || hasTitle ? (
                    <EmptyTitle className={cn(isLoading && 'flex items-center gap-2')}>
                        {/* 转圈只在加载态出现，与文案同排；文案本身已可播报，转圈隐藏起来以免重复朗读 */}
                        {isLoading ? <Spinner className="size-4" aria-hidden={hasTitle} /> : null}
                        {hasTitle ? title : null}
                    </EmptyTitle>
                ) : null}
                {isLoading || !description ? null : <EmptyDescription>{description}</EmptyDescription>}
            </EmptyHeader>
            {isLoading || children === undefined || children === null ? null : (
                <EmptyContent>{children}</EmptyContent>
            )}
        </UiEmpty>
    )
}

/**
 * 默认图标位内容：加载 / 留白页的项目 logo（icon.svg），低透明度铺满图标位。
 * 关键约束：必须是模块级函数组件 —— 内联箭头函数每轮渲染都是新类型，
 * 会让 Image 被卸载重挂，加载态跟着重置。
 */
function BrandLogo(): JSX.Element {
    return <Image src={logoIcon} alt="" className="size-32 object-contain opacity-10" />
}
