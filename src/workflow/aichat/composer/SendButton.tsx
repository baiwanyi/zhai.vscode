/**
 * 发送按钮：常态发送，生成中在同一位置替换为停止，两者互斥不并列。
 * 复用约定：按钮取 @webview/components/Button 的 icon 尺寸，悬停说明经其 tooltip 参数给出；
 * 图标取 lucide-react：可发送时 SendHorizontal（旋转 -90 与文字基线齐）、生成中为 Square。
 * 关键约束：图标按钮没有可见文字，可访问名由 aria-label 承担，tooltip 只作视觉补充；
 * 不可发送时保留灰底并禁用，避免按钮在「空输入」与「主色可点」之间跳色；
 * 文案按场景由调用方覆盖（如「发送」「取消生成」），默认发送 / 停止生成。
 */
import { cn } from 'cn'
import { SendHorizontal, Square } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface SendButtonProps {
    /** 生成中：同位置换为停止入口 */
    isGenerating: boolean
    /** 是否可发送：false 时保留灰底并禁用 */
    canSend: boolean
    /** 发送动作的可访问名与提示，默认「发送」 */
    sendLabel?: string
    /** 停止动作的可访问名与提示，默认「停止生成」 */
    stopLabel?: string
    onSend: () => void
    onStop: () => void
}

export function SendButton({
    isGenerating,
    canSend,
    sendLabel = '发送',
    stopLabel = '停止生成',
    onSend,
    onStop,
}: SendButtonProps): JSX.Element {
    if (isGenerating) {
        return (
            <Button
                variant="ghost"
                size="icon"
                className="bg-white/5 text-white hover:bg-white/8  dark:hover:bg-white/8"
                aria-label={stopLabel}
                tooltip={stopLabel}
                onClick={onStop}
            >
                <Square />
            </Button>
        )
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            className={cn(
                canSend
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 dark:hover:bg-primary/90'
                    : 'bg-white/5 text-muted-foreground disabled:opacity-100',
            )}
            aria-label={sendLabel}
            tooltip={sendLabel}
            disabled={!canSend}
            onClick={onSend}
        >
            <SendHorizontal className="-rotate-90" />
        </Button>
    )
}
