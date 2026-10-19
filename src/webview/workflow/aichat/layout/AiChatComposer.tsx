/**
 * AI 对话底部区域：待发送上下文清单（存在时挂载）+ 输入卡片 + 底部提示行，纵向布局。
 * 组合同目录 AiChatContextList / AiChatPromptInput / AiChatStatusHint，交互全部经回调上抛给页面 hooks。
 * 关键约束：模式、用量与写回目标均由此层透传，输入卡片不直接读取会话状态。
 */
import type { AiContextRef, AiConversationMode } from '@/shared/types/aiChat'
import { AiChatContextList } from './AiChatContextList'
import { AiChatPromptInput } from './AiChatPromptInput'
import { AiChatStatusHint } from './AiChatStatusHint'
import type { AiCommand, AiReferenceSource } from '../constants'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'

interface AiChatComposerProps {
    contexts: AiContextRef[]
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    isGenerating: boolean
    phase: Phase
    mode: AiConversationMode
    usedTokens: number
    dailyTokenBudget: number
    hasWriteTarget: boolean
    error: string | null
    notice: string | null
    /** 模式相关的补充提示，优先级低于错误与操作提示 */
    hint: string | null
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
    onClearContexts: () => void
    onCommand: (command: AiCommand) => void
    onReference: (source: AiReferenceSource) => void
    onModeChange: (mode: AiConversationMode) => void
}

export function AiChatComposer({
    contexts,
    input,
    setInput,
    hasApiKey,
    isGenerating,
    phase,
    mode,
    usedTokens,
    dailyTokenBudget,
    hasWriteTarget,
    error,
    notice,
    hint,
    onSend,
    onStop,
    onRemoveContext,
    onClearContexts,
    onCommand,
    onReference,
    onModeChange,
}: AiChatComposerProps): JSX.Element {
    return (
        <footer className="flex flex-col gap-2 p-3">
            {contexts.length > 0 ? (
                <AiChatContextList contexts={contexts} onRemove={onRemoveContext} onClear={onClearContexts} />
            ) : null}
            <AiChatPromptInput
                input={input}
                setInput={setInput}
                hasApiKey={hasApiKey}
                isGenerating={isGenerating}
                phase={phase}
                mode={mode}
                usedTokens={usedTokens}
                dailyTokenBudget={dailyTokenBudget}
                hasWriteTarget={hasWriteTarget}
                onCommand={onCommand}
                onReference={onReference}
                onModeChange={onModeChange}
                onSend={onSend}
                onStop={onStop}
            />
            <AiChatStatusHint error={error} notice={notice} hint={hint} isGenerating={isGenerating} />
        </footer>
    )
}
