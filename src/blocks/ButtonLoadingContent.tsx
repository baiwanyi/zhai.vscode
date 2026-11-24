/**
 * 按钮加载态内容：加载中用不可见文案占位，默认以 Spinner 绝对居中覆盖，也可改用调用方给的自定义图标。
 * 复用约定：Spinner 取 @components/ui/spinner，文案与自定义图标均可传任意 ReactNode；
 * 占位与覆盖层类名沿用按钮口径，供确认对话框、Button 自身等需要保留按钮宽度的场景复用。
 * 关键约束：绝对覆盖要求调用方给按钮容器加 relative；占位文案不可见且不进无障碍树，读屏名称由 aria-label 提供；
 * 默认值按 icon 是否给出推导（无 icon 用覆盖层 + invisible，有 icon 用内联 + contents invisible），显式传入可覆盖；
 * Spinner 的 block + origin-center + transform-fill 是居中与旋转轴口径，缺一不可。
 */
import { Spinner } from '@components/ui/spinner'
import type { JSX, ReactNode } from 'react'

export interface ButtonLoadingContentProps {
    /** 按钮文案，加载时作为占位保留按钮宽度 */
    label: ReactNode
    /** 是否处于加载态 */
    isLoading: boolean
    /** 自定义加载图标：给出时替代默认 Spinner，默认按普通内容排布 */
    icon?: ReactNode
    /** 加载图标是否绝对覆盖按钮内容区；省略时按 icon 是否给出推导 */
    overlay?: boolean
    /** 占位文案类名：省略时按 overlay 推导（覆盖用 invisible，内联用 contents invisible） */
    placeholderClassName?: string
}

export function ButtonLoadingContent({
    label,
    isLoading,
    icon,
    overlay,
    placeholderClassName,
}: ButtonLoadingContentProps): JSX.Element {
    if (!isLoading) {
        return <>{label}</>
    }

    const isOverlay = overlay ?? (icon === undefined)
    const placeholderClass = placeholderClassName ?? (isOverlay ? 'invisible' : 'contents invisible')
    const placeholder = <span className={placeholderClass}>{label}</span>
    const indicator = icon ?? <Spinner className="block origin-center transform-fill" aria-hidden />

    if (!isOverlay) {
        return (
            <>
                {placeholder}
                {indicator}
            </>
        )
    }

    return (
        <>
            {placeholder}
            <span className="absolute inset-0 flex items-center justify-center">{indicator}</span>
        </>
    )
}
