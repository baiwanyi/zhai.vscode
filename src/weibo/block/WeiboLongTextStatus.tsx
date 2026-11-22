/**
 * 长文展开态：加载中给转圈，失败或尚未进入视口时给可点按钮，主贴与转发体共用同一套外观。
 * 复用约定：状态由 hooks/useWeiboLongText 给出，重试回调由调用方接上（手动重试才会弹错误提示）。
 * 关键约束：只做展示、不发请求；文案只在「重新加载全文」与「加载全文」之间切换。
 */
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

export interface WeiboLongTextStatusProps {
    /** 全文请求进行中：只给转圈，不铺按钮 */
    isLoading: boolean
    /** 上一轮取全文失败：按钮文案换成重试 */
    hasFailed: boolean
    onRetry: () => void
}

export function WeiboLongTextStatus({ isLoading, hasFailed, onRetry }: WeiboLongTextStatusProps): JSX.Element {
    if (isLoading) {
        return <Spinner />
    }
    return (
        <Button variant="ghost" onClick={onRetry}>
            {hasFailed ? '重新加载全文' : '加载全文'}
        </Button>
    )
}
