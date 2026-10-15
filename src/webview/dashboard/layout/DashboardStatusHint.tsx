/**
 * 仪表盘底部提示行：错误优先于动作提示，两者皆无时不占位。
 * 纯展示组件；错误态用 destructive 前景色，其余为弱化前景色。
 * 关键约束：仅在确有文案时渲染，避免为空字符串留下一条空白行。
 */
import { cn } from 'cn'
import type { JSX } from 'react'

interface DashboardStatusHintProps {
    error: string | null
    notice: string | null
}

export function DashboardStatusHint({ error, notice }: DashboardStatusHintProps): JSX.Element | null {
    const text = error ?? notice
    if (text === null) {
        return null
    }
    return <p className={cn('px-3 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{text}</p>
}
