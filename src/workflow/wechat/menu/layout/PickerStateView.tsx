/**
 * 素材选择器三态视图：加载中、读取失败与空列表共用同一套骨架与出口。
 * 复用约定：错误提示走 components/Alert 并复用其重试加载态，空态走 blocks/Empty，图标按业务由调用方给出；
 * 关键约束：三态互斥，status 为 ready 且非空时不渲染节点，调用方据此继续渲染正常列表；
 * 本组件不推断数据来源，也不在内部触发取数。
 */
import { Empty } from '@webview/blocks/Empty'
import { Alert } from '@webview/components/Alert'
import type { ComponentType, JSX } from 'react'

interface PickerStateViewProps {
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isEmpty: boolean
    icon: ComponentType<{ className?: string }>
    loadingTitle: string
    errorTitle: string
    emptyTitle: string
    emptyDescription: string
    onRetry: () => void | Promise<void>
}

export function PickerStateView({
    status,
    error,
    isEmpty,
    icon: Icon,
    loadingTitle,
    errorTitle,
    emptyTitle,
    emptyDescription,
    onRetry,
}: PickerStateViewProps): JSX.Element | null {
    if (status === 'error') {
        return (
            <Alert
                variant="destructive"
                title={errorTitle}
                description={error ?? '请稍后重试'}
                icon={<Icon aria-hidden="true" />}
                callback={onRetry}
                actionText="重试"
                actionStatus="outline"
            />
        )
    }
    if (status === 'loading') {
        return <Empty icon={Icon} iconClassName="size-10 rounded-xl" title={loadingTitle} isLoading />
    }
    if (isEmpty) {
        return (
            <Empty icon={Icon} iconClassName="size-10 rounded-xl" title={emptyTitle} description={emptyDescription} />
        )
    }
    return null
}
