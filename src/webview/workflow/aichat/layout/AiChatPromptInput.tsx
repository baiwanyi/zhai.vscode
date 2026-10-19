/**
 * AI 对话输入卡片：顶部工具行（命令 / 参考）、多行输入框、底部操作行三段式。
 * 复用 @/components/ui 的 InputGroup 组合三个独立子组件，Enter 发送、Shift+Enter 换行保持不变。
 * 关键约束：增强提示词为本地规则化处理并保留还原入口；写作模式缺少可改写目标时禁止发送。
 */
import { useState } from 'react'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import type { AiConversationMode } from '@/shared/types/aiChat'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import type { AiCommand, AiReferenceSource } from '../constants'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'
import { enhancePrompt } from '../utils'

interface AiChatPromptInputProps {
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    isGenerating: boolean
    phase: Phase
    mode: AiConversationMode
    usedTokens: number
    dailyTokenBudget: number
    /** 写作模式下是否存在可改写的编辑器目标 */
    hasWriteTarget: boolean
    onCommand: (command: AiCommand) => void
    onReference: (source: AiReferenceSource) => void
    onModeChange: (mode: AiConversationMode) => void
    onSend: () => void
    onStop: () => void
}

export function AiChatPromptInput({
    input,
    setInput,
    hasApiKey,
    isGenerating,
    phase,
    mode,
    usedTokens,
    dailyTokenBudget,
    hasWriteTarget,
    onCommand,
    onReference,
    onModeChange,
    onSend,
    onStop,
}: AiChatPromptInputProps): JSX.Element {
    /** 增强前的原文：非空表示当前输入处于增强态，可一键还原 */
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)

    const canEnhance = input.trim().length > 0
    const canSend =
        hasApiKey && phase === 'idle' && input.trim().length > 0 && (mode === 'chat' || hasWriteTarget)

    /** 手动输入或修改即退出增强态，避免还原时覆盖用户的新内容 */
    const handleInputChange = (value: string): void => {
        setEnhancedFrom(null)
        setInput(value)
    }

    const handleEnhance = (): void => {
        const next = enhancePrompt(input, mode)
        if (next.length === 0 || next === input) {
            return
        }
        setEnhancedFrom(input)
        setInput(next)
    }

    const handleUndoEnhance = (): void => {
        if (enhancedFrom === null) {
            return
        }
        setInput(enhancedFrom)
        setEnhancedFrom(null)
    }

    return (
        <InputGroup className="h-auto flex-col items-stretch rounded-2xl bg-input-background">
            <AiChatComposerToolbar disabled={isGenerating} onCommand={onCommand} onReference={onReference} />
            <InputGroupTextarea
                value={input}
                className="min-h-[64px] max-h-40"
                placeholder={hasApiKey ? '提问或输入指令…' : '请先设置 DeepSeek API Key'}
                disabled={!hasApiKey || isGenerating}
                onChange={(event) => handleInputChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        if (canSend) {
                            onSend()
                        }
                    }
                }}
            />
            <AiChatComposerActions
                mode={mode}
                isGenerating={isGenerating}
                canSend={canSend}
                canEnhance={canEnhance}
                isEnhanced={enhancedFrom !== null}
                usedTokens={usedTokens}
                dailyTokenBudget={dailyTokenBudget}
                onModeChange={onModeChange}
                onEnhance={handleEnhance}
                onUndoEnhance={handleUndoEnhance}
                onSend={onSend}
                onStop={onStop}
            />
        </InputGroup>
    )
}
