/**
 * 提示词增强按钮：一键把输入内容补齐为结构化提示词，增强后同一位置变为还原。
 * 复用约定：按钮取 @webview/components/Button 的 icon 尺寸，悬停说明经其 tooltip 参数给出；
 * 图标按钮没有可见文字，可访问名由 aria-label 承担，tooltip 只作视觉补充。
 * 关键约束：只上抛意图，不改写输入框——原文的保存与还原由调用方负责；
 * 增强若走网络请求，进行中传 isBusy 交给 Button 的 isLoading（转圈、保留占位宽度、点击丢弃）；
 * tooltip 依赖挂载器的 TooltipProvider（见 bootstrap），单独渲染时须自行包裹。
 */
import { cn } from 'cn'
import { Sparkles, Undo2 } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface EnhanceButtonProps {
    disabled: boolean
    /** 当前输入是否为增强后的结果：决定图标与点击动作 */
    isEnhanced: boolean
    /** 增强进行中：转圈并禁用；与 disabled 分开，便于区分「不可用」与「进行中」 */
    isBusy?: boolean
    /** 额外类名：仅用于在各操作行里调位置（如 ml-auto），不改按钮自身的视觉 */
    className?: string
    onEnhance: () => void
    onUndo: () => void
}

export function EnhanceButton({
    disabled,
    isEnhanced,
    isBusy = false,
    className,
    onEnhance,
    onUndo,
}: EnhanceButtonProps): JSX.Element {
    const label = isEnhanced ? '还原提示词' : '增强提示词'

    return (
        <Button
            variant="ghost"
            size="icon"
            className={cn(
                'bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground dark:hover:bg-white/8 dark:hover:text-foreground disabled:opacity-100',
                className,
            )}
            aria-label={label}
            tooltip={label}
            isLoading={isBusy}
            disabled={disabled}
            onClick={isEnhanced ? onUndo : onEnhance}
        >
            {isEnhanced ? <Undo2 /> : <Sparkles />}
        </Button>
    )
}
