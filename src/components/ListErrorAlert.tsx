/**
 * 列表读取失败提示：统一 destructive Alert 的图标、标题与详情兜底，恢复出口由 action 槽位给出。
 * 复用 @components/ui 的 alert 与 @shared/utils/error 的 toErrorDetail：详情为 null 或空白串时给出可读兜底。
 * 关键约束：action 经 AlertAction 渲染在右上角，Alert 基类已按其 data-slot 预留宽度，勿把按钮塞进描述行；
 * 标题由调用方给（如「回收站读取失败」「搜索失败」），本组件不推断错误来源。
 */
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@components/ui/alert'
import { toErrorDetail } from '@shared/utils/error'
import type { JSX, ReactNode } from 'react'

interface ListErrorAlertProps {
    /** 失败标题：由调用方区分来源 */
    title: string
    /** 原始错误文案：null 或空白串时回退到通用说明 */
    error: string | null
    /** 恢复出口：如搜索失败时的「清除条件」按钮 */
    action?: ReactNode
}

export function ListErrorAlert({ title, error, action }: ListErrorAlertProps): JSX.Element {
    return (
        <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{toErrorDetail(error)}</AlertDescription>
            {action !== undefined ? <AlertAction>{action}</AlertAction> : null}
        </Alert>
    )
}
