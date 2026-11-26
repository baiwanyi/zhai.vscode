/**
 * 通用内联提示条：读取失败、操作结果等提示统一走这里，图标、文案与动作由调用方按需给出。
 * 复用约定：结构取 @components/ui/alert（底座别名 AlertPrimitive 避免同名递归），动作按钮取
 * @webview/components/Button；文案归一复用 @shared/utils/error 的 toErrorText / toErrorDetail，
 * 按钮变体类型由 ComponentProps<typeof Button> 推导，不新增工具函数或类型出口；className 交给底座合并，排在预设样式之后。
 * 关键约束：callback 可返回 Promise，组件自管 loading 与失败文案，但成功与否都不代调用方重取数据；
 * 动作仅在 callback 给出时渲染，加载中禁用按钮并通过 void 包裹避免误触重复提交。
 */
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Alert as AlertPrimitive, AlertAction, AlertDescription, AlertTitle } from '@components/ui/alert'
import { toErrorDetail, toErrorText } from '@shared/utils/error'
import { ButtonLoadingContent } from '@webview/blocks/ButtonLoadingContent'
import { Button } from '@webview/components/Button'
import type { ComponentProps, JSX, ReactElement } from 'react'

/** 动作按钮变体：直接取项目 Button 的档位，含 primary 但不含 null */
type AlertButtonVariant = NonNullable<ComponentProps<typeof Button>['variant']>

export interface AlertProps {
    title: string
    description?: string
    variant?: 'default' | 'destructive'
    icon?: ReactElement
    callback?: () => void | Promise<void>
    actionText?: string
    actionStatus?: AlertButtonVariant
    /** 覆盖底座外观：由 @components/ui/alert 合并，排在预设样式之后 */
    className?: string
}

export function Alert({
    title,
    description,
    variant = 'default',
    icon = <TriangleAlert aria-hidden="true" />,
    callback,
    actionText = '确认',
    actionStatus = 'default',
    className,
}: AlertProps): JSX.Element {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleAction = async (): Promise<void> => {
        setError(null)
        setIsLoading(true)
        try {
            await callback?.()
        } catch (cause) {
            setError(toErrorDetail(toErrorText(cause), '操作失败'))
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <AlertPrimitive variant={variant} className={className}>
            {icon}
            <AlertTitle>{title}</AlertTitle>
            {description === undefined ? null : <AlertDescription>{description}</AlertDescription>}
            {error === null ? null : <p className="mt-2 text-sm text-destructive">{error}</p>}
            {callback === undefined ? null : (
                <AlertAction>
                    <Button
                        size="xs"
                        variant={actionStatus}
                        aria-label={actionText}
                        disabled={isLoading}
                        onClick={(): void => {
                            void handleAction()
                        }}
                    >
                        <ButtonLoadingContent label={actionText} isLoading={isLoading} />
                    </Button>
                </AlertAction>
            )}
        </AlertPrimitive>
    )
}
