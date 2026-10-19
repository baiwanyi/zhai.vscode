/**
 * AI 对话增强按钮：把输入内容补齐为目标、要求与输出格式的结构化提示词，再次点击还原。
 * 复用 @/components/ui 的 InputGroupButton，状态与文案全部由调用方注入。
 * 关键约束：仅本地规则化处理，不发起网络请求；还原能力依赖调用方保存的原文。
 */
import { Sparkles, Undo2 } from 'lucide-react'
import { InputGroupButton } from '@/components/ui/input-group'
import type { JSX } from 'react'

interface AiChatEnhanceButtonProps {
    disabled: boolean
    /** 当前输入是否为增强后的结果 */
    isEnhanced: boolean
    onEnhance: () => void
    onUndo: () => void
}

export function AiChatEnhanceButton({
    disabled,
    isEnhanced,
    onEnhance,
    onUndo,
}: AiChatEnhanceButtonProps): JSX.Element {
    return (
        <InputGroupButton
            size="icon-sm"
            variant="ghost"
            className="rounded-full"
            title={isEnhanced ? '还原提示词' : '增强提示词'}
            aria-label={isEnhanced ? '还原提示词' : '增强提示词'}
            disabled={disabled}
            onClick={isEnhanced ? onUndo : onEnhance}
        >
            {isEnhanced ? <Undo2 /> : <Sparkles />}
        </InputGroupButton>
    )
}
