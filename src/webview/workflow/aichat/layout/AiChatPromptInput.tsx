/**
 * AI 对话输入卡片：顶部工具行（命令 / 参考）、多行输入框、底部操作行三段式。
 * 外层圆角卡片内嵌一块独立底色的输入区（与卡片底色区分），无边框与焦点描边，Enter 发送、Shift+Enter 换行。
 * 关键约束：增强提示词为本地规则化处理并保留还原入口；写作模式缺少可改写目标时禁止发送。
 */
import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
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
    /** 运行时信息是否已加载：未加载时保持中性占位文案，避免先闪「请设置密钥」 */
    isRuntimeReady: boolean
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
    isRuntimeReady,
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
    /** 仅当运行时已确认无密钥时才提示设置，加载期间保持中性文案 */
    const isApiKeyMissing = isRuntimeReady && !hasApiKey

    const canEnhance = input.trim().length > 0
    const canSend = hasApiKey && phase === 'idle' && input.trim().length > 0 && (mode === 'chat' || hasWriteTarget)

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
        <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
            <AiChatComposerToolbar disabled={isGenerating} onCommand={onCommand} onReference={onReference} />
            <div className="rounded-xl bg-composer-input p-3">
                <Textarea
                    value={input}
                    className="max-h-40 min-h-17 p-0 overflow-y-auto resize-none border-0 bg-transparent text-sm shadow-none rounded-none transition-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
                    placeholder={isApiKeyMissing ? '请先设置 DeepSeek API Key' : '提问或输入指令…'}
                    disabled={isApiKeyMissing || isGenerating}
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
            </div>
        </div>
    )
}
