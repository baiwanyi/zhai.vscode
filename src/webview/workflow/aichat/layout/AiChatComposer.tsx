/**
 * AI 对话底部区域：待发送上下文清单（存在时挂载）+ 输入区 + 底部提示行，纵向布局。
 * 组合同目录 AiChatContextList / AiChatPromptInput / AiChatStatusHint，交互全部经回调上抛给页面 hooks。
 */
import type { AiContextRef } from '@/shared/types/aiChat'
import { AiChatContextList } from './AiChatContextList'
import { AiChatPromptInput } from './AiChatPromptInput'
import { AiChatStatusHint } from './AiChatStatusHint'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'

interface AiChatComposerProps {
    contexts: AiContextRef[]
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    isGenerating: boolean
    phase: Phase
    error: string | null
    notice: string | null
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
    onClearContexts: () => void
    onOpenSettings: () => void
}

export function AiChatComposer({
    contexts,
    input,
    setInput,
    hasApiKey,
    isGenerating,
    phase,
    error,
    notice,
    onSend,
    onStop,
    onRemoveContext,
    onClearContexts,
    onOpenSettings,
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
                onSend={onSend}
                onStop={onStop}
                onOpenSettings={onOpenSettings}
            />
            <AiChatStatusHint error={error} notice={notice} isGenerating={isGenerating} />
        </footer>
    )
}
