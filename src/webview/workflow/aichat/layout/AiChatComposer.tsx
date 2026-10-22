/**
 * AI 对话底部区域：输入卡片 + 底部提示行，纵向布局；命令与上下文引用统一以芯片呈现在输入区内。
 * 组合同目录 AiChatPromptInput / AiChatStatusHint，交互全部经回调上抛给页面 hooks。
 * 关键约束：模式、用量、已选命令、上下文与写回目标均由此层透传，输入卡片不直接读取会话状态。
 */
import type { AiContextRef, AiConversationMode, AiModelChoices } from '@shared/types/aiChat'
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
    /** 当前模型 id，空表示使用 CLI 默认模型 */
    model: string
    /** 模型菜单数据：未展开过时为 null */
    modelChoices: AiModelChoices | null
    isLoadingModels: boolean
    /** 当前已选写作命令：输入区以徽章展示，指令模板不进入输入框 */
    command: AiCommand | null
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
    onCommand: (command: AiCommand) => void
    onOpenModels: () => void
    onSelectModel: (modelId: string, manual: boolean) => void
    onClearCommand: () => void
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
    model,
    modelChoices,
    isLoadingModels,
    command,
    onSend,
    onStop,
    onRemoveContext,
    onCommand,
    onOpenModels,
    onSelectModel,
    onClearCommand,
    onReference,
    onModeChange,
}: AiChatComposerProps): JSX.Element {
    return (
        <footer className="flex flex-col gap-2 px-3">
            <AiChatPromptInput
                contexts={contexts}
                input={input}
                setInput={setInput}
                hasApiKey={hasApiKey}
                isGenerating={isGenerating}
                phase={phase}
                mode={mode}
                usedTokens={usedTokens}
                dailyTokenBudget={dailyTokenBudget}
                hasWriteTarget={hasWriteTarget}
                model={model}
                modelChoices={modelChoices}
                isLoadingModels={isLoadingModels}
                command={command}
                onCommand={onCommand}
                onOpenModels={onOpenModels}
                onSelectModel={onSelectModel}
                onClearCommand={onClearCommand}
                onRemoveContext={onRemoveContext}
                onReference={onReference}
                onModeChange={onModeChange}
                onSend={onSend}
                onStop={onStop}
            />
            <AiChatStatusHint error={error} notice={notice} hint={hint} isGenerating={isGenerating} />
        </footer>
    )
}
