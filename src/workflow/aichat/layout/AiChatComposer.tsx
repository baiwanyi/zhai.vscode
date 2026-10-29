/**
 * AI 对话底部输入卡片：顶部工具行（命令 / 参考）、富文本输入区（内联命令与上下文芯片）、底部操作行。
 * 复用约定：外壳挂载在页面的 AppFooter 内，工具行 / 操作行复用同目录 AiChatComposerToolbar 与
 * AiChatComposerActions，富文本输入取 @webview/components/RichChipInput（与生图输入卡片共用同一份）；
 * 命令与上下文在此折算为 RichChip：图标取 ./commandIcons，文件名与摘要取 ../utils。
 * 本层负责提示文案、禁用态与增强状态，交互全部经回调上抛给页面 hooks。
 * 生成态光晕取 @webview/components/ComposerGlow（与生图页共用，样式在 globals.css 的 composer-glow 段）。
 * 关键约束：模式、上下文用量、已选命令、上下文与写回目标均由此层透传，输入卡片不直接读取会话状态；
 * 命令芯片的移除语义是「取消命令」，由 chip.onRemove 承担，不走统一的移除引用回调；
 * 增强提示词经页面 hook 请求宿主模型改写（onEnhanceRequest），本层只保存原文并保留还原入口；
 * 光晕是卡片外侧的兄弟层（卡片底色不透明），容器需自带 isolate，装饰层不承载任何状态或交互；
 * 横向内边距由 AppPage 统一提供，此处不再自带 px，否则会与骨架的 p-3 叠加成双重缩进。
 */
import { FileText, TextSelect } from 'lucide-react'
import { useState } from 'react'
import type { AiContextRef, AiContextUsage, AiConversationMode, AiModelChoices } from '@shared/types/aiChat'
import { ComposerGlow } from '@webview/components/ComposerGlow'
import { RichChipInput, type RichChip } from '@webview/components/RichChipInput'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand, AiReferenceSource } from '../constants'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'
import { describeContext, toContextFileName } from '../utils'

/** 命令芯片的保留 id：只用于 React key 与退格查找，移除语义由 onRemove 承担 */
const COMMAND_CHIP_ID = 'ai-command'

/** 命令芯片：图标取命令表，移除按钮即「取消命令」 */
function buildCommandChip(command: AiCommand, onClearCommand: () => void): RichChip {
    const Icon = COMMAND_ICONS[command.id]
    return {
        id: COMMAND_CHIP_ID,
        label: command.title,
        icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
        badgeClassName: 'max-w-40',
        removeLabel: '取消命令',
        onRemove: onClearCommand,
    }
}

/** 上下文芯片：文件名悬停出相对路径，尾部给字数 / 行数摘要，移除走页面回调 */
function buildContextChip(context: AiContextRef): RichChip {
    return {
        id: context.id,
        label: toContextFileName(context),
        icon:
            context.kind === 'selection' ? (
                <TextSelect className="size-3 shrink-0 text-muted-foreground" />
            ) : (
                <FileText className="size-3 shrink-0 text-muted-foreground" />
            ),
        hint: context.displayPath,
        meta: describeContext(context),
        removeLabel: '移除该引用',
    }
}

interface AiChatComposerProps {
    /** 已添加的上下文引用：以内联芯片呈现在输入区首行 */
    contexts: AiContextRef[]
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    isGenerating: boolean
    phase: Phase
    mode: AiConversationMode
    /** 当前会话上下文占用：null 表示尚未生成过 */
    contextUsage: AiContextUsage | null
    /** 写作模式下是否存在可改写的编辑器目标 */
    hasWriteTarget: boolean
    /** 当前模型 id，空表示使用 CLI 默认模型 */
    model: string
    /** 当前模型展示名：清单未拉取时由运行时提供，空串表示未知 */
    modelName: string
    /** 模型菜单数据：未展开过时为 null */
    modelChoices: AiModelChoices | null
    isLoadingModels: boolean
    /** 当前已选写作命令：输入区以芯片展示，指令模板不进入输入框 */
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
    /** 增强请求进行中：按钮转圈并丢弃重复点击 */
    isEnhancing: boolean
    /** 增强请求：由页面 hook 走宿主协议，失败返回 null */
    onEnhanceRequest: (text: string, mode: AiConversationMode) => Promise<string | null>
}

export function AiChatComposer({
    contexts,
    input,
    setInput,
    hasApiKey,
    isGenerating,
    phase,
    mode,
    contextUsage,
    hasWriteTarget,
    model,
    modelName,
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
    isEnhancing,
    onEnhanceRequest,
}: AiChatComposerProps): JSX.Element {
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

    /** 芯片集合：命令在前、上下文按添加顺序随后，与输入区的展示顺序一致 */
    const chips: RichChip[] = [
        ...(command === null ? [] : [buildCommandChip(command, onClearCommand)]),
        ...contexts.map(buildContextChip),
    ]

    /** 手动输入或修改即退出增强态，避免还原时覆盖用户的新内容 */
    const handleInputChange = (value: string): void => {
        setEnhancedFrom(null)
        setInput(value)
    }

    /** 增强走后端改写：成功后记下原文供还原，失败由 hook 提示并保持原文 */
    const handleEnhance = (): void => {
        void onEnhanceRequest(input, mode).then((next) => {
            if (next === null || next.length === 0 || next === input) {
                return
            }
            setEnhancedFrom(input)
            setInput(next)
        })
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
        <div className="relative isolate flex-1">
            <ComposerGlow isGenerating={isGenerating} />

            <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
                <AiChatComposerToolbar
                    disabled={isGenerating}
                    activeCommandId={command?.id ?? null}
                    onCommand={onCommand}
                    onReference={onReference}
                />
                <div className="rounded-xl bg-composer-input p-3">
                    <RichChipInput
                        value={input}
                        chips={chips}
                        placeholder={placeholder}
                        disabled={isGenerating}
                        canSend={canSend}
                        onChange={handleInputChange}
                        onSend={onSend}
                        onRemoveChip={onRemoveContext}
                    />

                    <AiChatComposerActions
                        mode={mode}
                        isGenerating={isGenerating}
                        canSend={canSend}
                        canEnhance={canEnhance}
                        isEnhanced={enhancedFrom !== null}
                        isEnhancing={isEnhancing}
                        contextUsage={contextUsage}
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
