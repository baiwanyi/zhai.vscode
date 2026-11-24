/**
 * 通用二次确认警告对话框：删除、恢复等不可逆操作统一走这里，文案与按钮语义由调用方提供。
 * 复用约定：结构取 @components/ui 的 alert-dialog，破坏性操作用 destructive 确认按钮；
 * 可选 icon 走 AlertDialogMedia，confirmStatus / cancelStatus 覆盖按钮变体，children 作可选触发器；
 * 关键约束：保留受控契约——组件不自行决定关闭时机，调用方需在 onConfirm 里先清空待处理项；
 * onConfirm 返回 Promise 时组件自行管理加载态并经 toastError 报错，成功与否都不代调用方关闭；
 * 加载中（外部 isSubmitting 或内部 Promise 在途）拦截所有关闭请求，避免误关打断操作。
 */
import { useRef, useState } from 'react'
import {
    AlertDialog as AlertDialogPrimitive,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@components/ui/alert-dialog'
import { toastError } from '@shared/utils/error'
import { ButtonLoadingContent } from '@webview/blocks/ButtonLoadingContent'
import type { ComponentProps, JSX, ReactNode } from 'react'

/** 按钮变体口径：直接取底座接受的类型（shadcn 原生档位，不含项目 Button 的 primary） */
type AlertDialogButtonVariant = ComponentProps<typeof AlertDialogAction>['variant']

/** 对话框宽度档位：sm 为窄版两列按钮，default 为常规单列按钮 */
export type AlertDialogSize = 'default' | 'sm'

export interface AlertDialogProps {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    /** 取消按钮文案，默认「取消」；仅删除类操作需要改写的场景才传 */
    cancelLabel?: string
    /** 删除等不可逆操作为 true，确认按钮走 destructive 样式 */
    isDestructive?: boolean
    /** 提交中为 true：两个按钮同时禁用，避免重复触发 */
    isSubmitting?: boolean
    /** 宽度档位，默认 default，与改造前的各弹窗保持一致 */
    size?: AlertDialogSize
    /** 标题前的图标，给出时以 AlertDialogMedia 承载 */
    icon?: ReactNode
    /** 覆盖确认按钮变体，省略时按 isDestructive 决定 */
    confirmStatus?: AlertDialogButtonVariant
    /** 覆盖取消按钮变体，默认 outline */
    cancelStatus?: AlertDialogButtonVariant
    /** 可选触发器：给出时以 AlertDialogTrigger asChild 承载，受控 open 仍由调用方持有 */
    children?: ReactNode
    onOpenChange: (isOpen: boolean) => void
    /** 确认回调：可返回 Promise，返回时组件自管加载态与错误提示，但不代调用方关闭 */
    onConfirm: () => void | Promise<void>
}

export function AlertDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel = '取消',
    isDestructive = false,
    isSubmitting = false,
    size = 'default',
    icon,
    confirmStatus,
    cancelStatus,
    children,
    onOpenChange,
    onConfirm,
}: AlertDialogProps): JSX.Element {
    const [isAsyncLoading, setIsAsyncLoading] = useState(false)
    /** 同步在途标记：setState 生效前的一帧内，Radix 的自动关闭请求也要被拦下 */
    const isPendingRef = useRef(false)
    const isBusy = isSubmitting || isAsyncLoading

    const handleOpenChange = (nextOpen: boolean): void => {
        if ((isBusy || isPendingRef.current) && !nextOpen) {
            return
        }
        onOpenChange(nextOpen)
    }

    const handleConfirm = (): void => {
        const result = onConfirm()
        if (!(result instanceof Promise)) {
            return
        }
        isPendingRef.current = true
        setIsAsyncLoading(true)
        const settle = async (): Promise<void> => {
            try {
                await result
            } catch (cause) {
                toastError(cause)
            } finally {
                isPendingRef.current = false
                setIsAsyncLoading(false)
            }
        }
        void settle()
    }

    return (
        <AlertDialogPrimitive open={open} onOpenChange={handleOpenChange}>
            {children === undefined ? null : <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
            <AlertDialogContent size={size}>
                <AlertDialogHeader>
                    {icon === undefined ? null : <AlertDialogMedia>{icon}</AlertDialogMedia>}
                    <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel variant={cancelStatus} disabled={isBusy}>
                        {cancelLabel}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        variant={confirmStatus ?? (isDestructive ? 'destructive' : 'default')}
                        disabled={isBusy}
                        aria-label={confirmLabel}
                        className={isBusy ? 'relative' : undefined}
                        onClick={handleConfirm}
                    >
                        <ButtonLoadingContent label={confirmLabel} isLoading={isBusy} />
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialogPrimitive>
    )
}
