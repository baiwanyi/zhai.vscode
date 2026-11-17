/**
 * 提示气泡统一出口：项目内 Tooltip 的样式契约与开合增强都从这里导出，业务侧不再直接引用 ui/tooltip。
 * 复用约定：包装 @components/ui/tooltip 的原语（Provider / Root / Trigger / Content 结构照旧），
 * 调用方把 TOOLTIP_CLASS 传给 TooltipContent 的 className，需要加宽或换字色时用 cn 追加；
 * 气泡固定暗底亮字（--foreground 作底、--background 作字），箭头继承同一组变量自动同色。
 * 关键约束：点击（触发层或气泡内）后气泡必须彻底消失——Radix 只在 pointerdown 期间临时遮挡，
 * pointerup 后指针仍在触发层、或触发层保持聚焦都会把气泡放回来，故由本组件接管开合并抑制重开，
 * 抑制在指针离开 / 失焦 / 重新进入时解除；各调用方不得自行改写该行为，也不得绕过本文件引用原语。
 */
'use client'

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Tooltip as BaseTooltip,
    TooltipContent as BaseTooltipContent,
    TooltipProvider as BaseTooltipProvider,
    TooltipTrigger as BaseTooltipTrigger,
} from '@components/ui/tooltip'
import type { ComponentProps, JSX } from 'react'

/**
 * 提示气泡统一暗底亮字：--foreground 换成暗色作气泡底，--background 取页面背景色作亮字，
 * 箭头随同一组变量同色。
 */
export const TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'

/** 点击后的开合控制：dismiss 关闭并抑制重开，release 解除抑制 */
interface TooltipDismissController {
    dismiss: () => void
    release: () => void
}

const TooltipDismissContext = createContext<TooltipDismissController | null>(null)

function TooltipProvider(props: ComponentProps<typeof BaseTooltipProvider>): JSX.Element {
    return <BaseTooltipProvider {...props} />
}

function Tooltip({
    open,
    defaultOpen,
    onOpenChange,
    ...props
}: ComponentProps<typeof BaseTooltip>): JSX.Element {
    const isControlled = open !== undefined
    const [isUncontrolledOpen, setIsUncontrolledOpen] = useState(defaultOpen ?? false)
    // 点击后置位：抑制外部受控状态把 open 置回 true，直到指针离开或失焦
    const [isDismissed, setIsDismissed] = useState(false)
    // 同值 ref：setOpen 是稳定回调，靠 ref 读取当前抑制状态，避免把它塞进依赖链
    const isDismissedRef = useRef(false)

    const isOpen = isControlled ? open : isUncontrolledOpen

    const setOpen = useCallback(
        (next: boolean): void => {
            // 抑制期内的打开请求（Radix 的 pointerup / 聚焦重开）一律丢弃，防止解除抑制时气泡凭空复活
            if (next && isDismissedRef.current) {
                return
            }
            if (!isControlled) {
                setIsUncontrolledOpen(next)
            }
            onOpenChange?.(next)
        },
        [isControlled, onOpenChange],
    )

    const dismiss = useCallback((): void => {
        isDismissedRef.current = true
        setIsDismissed(true)
        setOpen(false)
    }, [setOpen])

    const release = useCallback((): void => {
        isDismissedRef.current = false
        setIsDismissed(false)
    }, [])

    // 受控调用方（如按钮的聚焦态）可能在点击后把 open 又置回 true：这里回写 false，
    // 否则抑制解除的瞬间气泡会凭空复活
    useEffect((): void => {
        if (isDismissed && isOpen) {
            setOpen(false)
        }
    }, [isDismissed, isOpen, setOpen])

    const controller = useMemo<TooltipDismissController>(() => ({ dismiss, release }), [dismiss, release])

    return (
        <TooltipDismissContext value={controller}>
            <BaseTooltip {...props} open={isOpen && !isDismissed} onOpenChange={setOpen} />
        </TooltipDismissContext>
    )
}

function TooltipTrigger({
    onPointerDown,
    onClick,
    onPointerEnter,
    onPointerLeave,
    onBlur,
    ...props
}: ComponentProps<typeof BaseTooltipTrigger>): JSX.Element {
    const controller = use(TooltipDismissContext)
    return (
        <BaseTooltipTrigger
            {...props}
            onPointerDown={(event) => {
                onPointerDown?.(event)
                controller?.dismiss()
            }}
            onClick={(event) => {
                onClick?.(event)
                controller?.dismiss()
            }}
            onPointerEnter={(event) => {
                controller?.release()
                onPointerEnter?.(event)
            }}
            onPointerLeave={(event) => {
                controller?.release()
                onPointerLeave?.(event)
            }}
            onBlur={(event) => {
                controller?.release()
                onBlur?.(event)
            }}
        />
    )
}

function TooltipContent({
    onPointerDown,
    onPointerLeave,
    ...props
}: ComponentProps<typeof BaseTooltipContent>): JSX.Element {
    const controller = use(TooltipDismissContext)
    return (
        <BaseTooltipContent
            {...props}
            onPointerDown={(event) => {
                onPointerDown?.(event)
                // 气泡内的操作同属「点击完成」：执行即收起，不等指针离开触发层
                controller?.dismiss()
            }}
            onPointerLeave={(event) => {
                controller?.release()
                onPointerLeave?.(event)
            }}
        />
    )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
