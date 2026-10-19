/**
 * AI 对话输入卡片底部操作行：左侧模式切换，右侧 Token 圆环、增强提示词与发送 / 停止。
 * 采用普通行容器组合三个独立子组件，本层只做布局与禁用态分发。
 * 关键约束：生成中除圆环可查看外全部禁用，发送位替换为停止按钮；本层不持有任何会话状态。
 */
import { cn } from 'cn'
import { SendHorizontal, Square } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { AiConversationMode } from '@shared/types/aiChat'
import { AiChatEnhanceButton } from './AiChatEnhanceButton'
import { AiChatModeSwitch } from './AiChatModeSwitch'
import { AiChatTokenRing } from './AiChatTokenRing'
import type { JSX } from 'react'

interface AiChatComposerActionsProps {
    mode: AiConversationMode
    isGenerating: boolean
    canSend: boolean
    canEnhance: boolean
    isEnhanced: boolean
    usedTokens: number
    dailyTokenBudget: number
    onModeChange: (mode: AiConversationMode) => void
    onEnhance: () => void
    onUndoEnhance: () => void
    onSend: () => void
    onStop: () => void
}

export function AiChatComposerActions({
    mode,
    isGenerating,
    canSend,
    canEnhance,
    isEnhanced,
    usedTokens,
    dailyTokenBudget,
    onModeChange,
    onEnhance,
    onUndoEnhance,
    onSend,
    onStop,
}: AiChatComposerActionsProps): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-2 pt-1">
            <AiChatModeSwitch mode={mode} disabled={isGenerating} onChange={onModeChange} />
            <div className="flex items-center gap-0.5">
                <AiChatTokenRing used={usedTokens} budget={dailyTokenBudget} />
                <AiChatEnhanceButton
                    disabled={isGenerating || !canEnhance}
                    isEnhanced={isEnhanced}
                    onEnhance={onEnhance}
                    onUndo={onUndoEnhance}
                />
                {isGenerating ? (
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        className="rounded-lg text-muted-foreground"
                        title="停止生成"
                        aria-label="停止生成"
                        onClick={onStop}
                    >
                        <Square />
                    </Button>
                ) : (
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        className={cn(
                            'rounded-lg',
                            canSend
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-white/5 text-muted-foreground disabled:opacity-100',
                        )}
                        title="发送"
                        aria-label="发送"
                        disabled={!canSend}
                        onClick={onSend}
                    >
                        <SendHorizontal className="-rotate-90" />
                    </Button>
                )}
            </div>
        </div>
    )
}
