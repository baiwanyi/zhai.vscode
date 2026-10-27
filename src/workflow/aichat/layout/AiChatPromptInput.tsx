/**
 * AI 对话输入卡片：顶部工具行（命令 / 参考）、富文本输入区（内联命令与上下文芯片）、底部操作行。
 * 复用同目录 AiChatRichInput 承载不可编辑芯片与可编辑正文，本层只负责提示文案、禁用态与增强提示词编排；
 * 生成态光晕与生图页共用 globals.css 的 composer-glow 段（conic 旋转描边 + 模糊背光呼吸）。
 * 关键约束：命令与上下文只以芯片展示、指令模板在发送时拼装；增强提示词仅作用于可见正文并保留还原入口；
 * 存在命令时允许空输入直接发送，写作模式仍要求编辑器有可改写的目标；
 * 光晕必须挂在卡片外侧的兄弟层上——卡片底色不透明，移进卡片内部就会被盖住，装饰层不承载任何状态或交互。
 */
import { cn } from 'cn'
import { useState } from 'react'
import type { AiContextRef, AiConversationMode, AiModelChoices } from '@shared/types/aiChat'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import { AiChatRichInput } from './AiChatRichInput'
import type { AiCommand, AiReferenceSource } from '../constants'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'
import { enhancePrompt } from '../utils'

interface AiChatPromptInputProps {
    /** 已添加的上下文引用：以内联芯片呈现在输入区首行 */
    contexts: AiContextRef[]
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
    /** 当前模型 id，空表示使用 CLI 默认模型 */
    model: string
    /** 当前模型展示名：清单未拉取时由运行时提供，空串表示未知 */
    modelName: string
    /** 模型菜单数据：未展开过时为 null */
    modelChoices: AiModelChoices | null
    isLoadingModels: boolean
    /** 已选写作命令：非空时输入区首行展示命令芯片 */
    command: AiCommand | null
    onCommand: (command: AiCommand) => void
    onOpenModels: () => void
    onSelectModel: (modelId: string, manual: boolean) => void
    onClearCommand: () => void
    onRemoveContext: (id: string) => void
    onReference: (source: AiReferenceSource) => void
    onModeChange: (mode: AiConversationMode) => void
    onSend: () => void
    onStop: () => void
}

export function AiChatPromptInput({
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
    model,
    modelName,
    modelChoices,
    isLoadingModels,
    command,
    onCommand,
    onOpenModels,
    onSelectModel,
    onClearCommand,
    onRemoveContext,
    onReference,
    onModeChange,
    onSend,
    onStop,
}: AiChatPromptInputProps): JSX.Element {
    /** 增强前的原文：非空表示当前输入处于增强态，可一键还原 */
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)

    const canEnhance = input.trim().length > 0
    /** 已有命令时正文由指令模板提供，因此空输入也可发送 */
    const hasContent = command !== null || input.trim().length > 0
    const canSend = hasApiKey && phase === 'idle' && hasContent && (mode === 'chat' || hasWriteTarget)

    let placeholder = '提问或输入指令…'
    if (command !== null) {
        placeholder = `可补充「${command.title}」的要求，留空直接发送`
    }

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
        // isolate 给光晕划定层叠边界：-z-10 只在卡片之下，不会沉到页面背景后面
        <div className="relative isolate">
            {/* 生成态光晕：纯装饰层，pointer-events-none 且 aria-hidden，不参与布局与交互 */}
            <div
                aria-hidden
                data-glow={isGenerating ? 'on' : 'off'}
                className={cn(
                    'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500',
                    isGenerating ? 'opacity-100' : 'opacity-0',
                )}
            >
                <div className="composer-glow-halo absolute -inset-0.5 rounded-2xl opacity-60 blur-sm" />
                {/* 外扩量与 CSS 里的 padding（线宽）保持一致，描边才刚好贴在卡片边界外 */}
                <div className="composer-glow-edge absolute -inset-px rounded-2xl" />
            </div>

            <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
                <AiChatComposerToolbar
                    disabled={isGenerating}
                    activeCommandId={command?.id ?? null}
                    onCommand={onCommand}
                    onReference={onReference}
                />
                <div className="rounded-xl bg-composer-input p-3">
                    <AiChatRichInput
                        value={input}
                        command={command}
                        contexts={contexts}
                        placeholder={placeholder}
                        disabled={isGenerating}
                        canSend={canSend}
                        onChange={handleInputChange}
                        onSend={onSend}
                        onClearCommand={onClearCommand}
                        onRemoveContext={onRemoveContext}
                    />

                    <AiChatComposerActions
                        mode={mode}
                        isGenerating={isGenerating}
                        canSend={canSend}
                        canEnhance={canEnhance}
                        isEnhanced={enhancedFrom !== null}
                        usedTokens={usedTokens}
                        dailyTokenBudget={dailyTokenBudget}
                        model={model}
                        modelName={modelName}
                        modelChoices={modelChoices}
                        isLoadingModels={isLoadingModels}
                        onModeChange={onModeChange}
                        onOpenModels={onOpenModels}
                        onSelectModel={onSelectModel}
                        onEnhance={handleEnhance}
                        onUndoEnhance={handleUndoEnhance}
                        onSend={onSend}
                        onStop={onStop}
                    />
                </div>
            </div>
        </div>
    )
}
