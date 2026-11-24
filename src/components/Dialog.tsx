/**
 * 通用对话框：承载「标题 + 可选说明 + 自定义内容 + 可选页脚」的统一骨架，内容由调用方以 children 传入。
 * 复用约定：结构取 @components/ui 的 dialog 与 field-group，按钮取 @webview/components/Button；
 * 可选 trigger 以 DialogTrigger asChild 承载外部触发器；size 提供宽高预设，className 在最后覆盖外观；
 * 关键约束：组件不持有内容状态、也不决定提交成功后是否关闭，调用方在 onConfirm 里提交并自行关闭；
 * 高度自带上限：标题与页脚固定、内容区吃掉剩余高度并独立滚动，显式裁横向溢出以免光晕撑出滚动条；
 * isLoading 同时禁用取消与确认，confirmIcon 仅作加载态自定义图标，未给定时复用 Button 内置 Spinner。
 */
import { cn } from 'cn'
import {
    Dialog as DialogPrimitive,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@components/ui/dialog'
import { FieldGroup } from '@components/ui/field'
import { Button } from '@webview/components/Button'
import type { ButtonProps } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'

/** 宽高预设：default 保留内容区滚动所需的最大高度，其余档位自带高度、不再叠加上限 */
const SIZE_CLASSES = {
    full: 'h-[calc(100vh-3rem)] sm:max-w-[calc(100vw-3rem)]',
    screen: 'h-screen max-w-screen rounded-none top-0 left-0 translate-y-0 translate-x-0',
    default: 'max-h-[calc(100vh-4rem)] sm:max-w-sm',
    lg: 'h-[calc(100vh-3rem)] sm:max-w-[60%]',
    md: 'h-1/2 sm:max-w-3xl',
} as const

type DialogSize = keyof typeof SIZE_CLASSES

export interface DialogProps {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    title?: ReactNode
    /** 说明文案：省略时不渲染可见节点，仅留读屏描述 */
    description?: ReactNode
    showCloseButton?: boolean
    showFooter?: boolean
    size?: DialogSize
    /** 提交动作：可返回 Promise，本组件不据此关闭弹窗 */
    onConfirm?: () => void | Promise<void>
    isLoading?: boolean
    /** 仅禁用确认按钮，取消仍可用；与 isLoading 区分禁用原因 */
    isDisabled?: boolean
    children: ReactNode
    /** 外部触发器：给出时以 DialogTrigger asChild 承载 */
    trigger?: ReactNode
    confirmLabel?: ReactNode
    /** 加载态自定义图标：未给定时由 Button 的 isLoading 显示内置 Spinner */
    confirmIcon?: ReactNode
    confirmType?: ButtonProps['variant']
    /** 覆盖宽度等外观，排在 size 之后 */
    className?: string
    /** 打开时是否自动聚焦到可交互元素，默认不抢焦点 */
    autoFocus?: boolean
}

export function Dialog({
    open,
    onOpenChange,
    title,
    description,
    showCloseButton = true,
    showFooter = true,
    size = 'default',
    onConfirm,
    isLoading = false,
    isDisabled = false,
    children,
    trigger,
    confirmLabel = '保存更改',
    confirmIcon,
    confirmType,
    className,
    autoFocus = false,
}: DialogProps): JSX.Element {
    const handleConfirm = (): void => {
        void onConfirm?.()
    }

    return (
        <DialogPrimitive open={open} onOpenChange={onOpenChange}>
            {trigger === undefined ? null : <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent
                showCloseButton={showCloseButton}
                className={cn(
                    'grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4',
                    SIZE_CLASSES[size],
                    className,
                )}
                onOpenAutoFocus={autoFocus ? undefined : (event): void => { event.preventDefault() }}
            >
                <DialogHeader className="gap-1">
                    {title === undefined || title === null || title === '' ? null : (
                        <DialogTitle className="font-semibold text-lg">{title}</DialogTitle>
                    )}
                    {description === undefined || description === '' ? (
                        <DialogDescription className="sr-only">{title}</DialogDescription>
                    ) : (
                        <DialogDescription>{description}</DialogDescription>
                    )}
                </DialogHeader>
                {/* 纵向滚动区内不做横向滚动：光晕的 -inset 外扩仍计入溢出，横向 auto 会凭空冒出滚动条 */}
                <FieldGroup className="min-h-0 overflow-x-hidden overflow-y-auto">{children}</FieldGroup>
                {showFooter ? (
                    <DialogFooter>
                        {showCloseButton ? (
                            <Button variant="outline" disabled={isLoading} onClick={(): void => onOpenChange?.(false)}>
                                取消
                            </Button>
                        ) : null}
                        <Button
                            variant={confirmType}
                            onClick={handleConfirm}
                            disabled={isDisabled || isLoading}
                            isLoading={isLoading && confirmIcon === undefined}
                        >
                            {isLoading && confirmIcon !== undefined ? (
                                <>
                                    {/* 保留文案占位，自定义图标替换内置 Spinner 时按钮尺寸不抖 */}
                                    <span className="contents invisible">{confirmLabel}</span>
                                    {confirmIcon}
                                </>
                            ) : (
                                confirmLabel
                            )}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </DialogPrimitive>
    )
}
