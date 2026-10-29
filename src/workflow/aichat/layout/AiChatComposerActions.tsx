/**
 * AI 对话输入卡片底部操作行：左侧写入范围与模型菜单，右侧上下文圆环、增强提示词与发送 / 停止。
 * 采用普通行容器组合各独立子组件，本层只做布局与禁用态分发。
 * 关键约束：生成中除圆环可查看外全部禁用，发送位替换为停止按钮；本层不持有任何会话状态；
 * 工具审批默认逐次确认，连续生成的一次性授权在发送前确认。
 */
import type { AiContextUsage, AiModelChoices, AiReasoningEffort, AiWriteGrant } from '@shared/types/aiChat'
import { EnhanceButton } from '@webview/components/EnhanceButton'
import { SendButton } from '@webview/components/SendButton'
import { AiChatModelMenu } from './AiChatModelMenu'
import { AiChatTokenRing } from './AiChatTokenRing'
import { AiChatWriteGrantSwitch } from './AiChatWriteGrantSwitch'
import type { JSX } from 'react'

interface AiChatComposerActionsProps {
    /** 写入授权范围 */
    writeGrant: AiWriteGrant
    isGenerating: boolean
    canSend: boolean
    canEnhance: boolean
    isEnhanced: boolean
    /** 增强请求进行中：按钮转圈并丢弃重复点击 */
    isEnhancing: boolean
    /** 当前会话上下文占用：null 表示本轮还没有产出数据 */
    contextUsage: AiContextUsage | null
    /** 当前模型的上下文窗口：会话尚无占用数据时作为圆环分母 */
    contextWindowTokens: number
    /** 当前模型 id，空表示使用 CLI 默认模型 */
    model: string
    /** 当前模型展示名：清单未拉取时由运行时提供，空串表示未知 */
    modelName: string
    /** 模型菜单数据：未展开过时为 null */
    modelChoices: AiModelChoices | null
    isLoadingModels: boolean
    onWriteGrantChange: (grant: AiWriteGrant) => void
    onOpenModels: () => void
    onSelectModel: (modelId: string) => void
    /** 选择上下文档位：0 表示跟随模型默认 */
    onSelectContextWindow: (tokens: number) => void
    /** 选择推理强度：null 表示跟随模型默认 */
    onSelectEffort: (effort: AiReasoningEffort | null) => void
    onEnhance: () => void
    onUndoEnhance: () => void
    onSend: () => void
    onStop: () => void
}

export function AiChatComposerActions({
    writeGrant,
    isGenerating,
    canSend,
    canEnhance,
    isEnhanced,
    isEnhancing,
    contextUsage,
    contextWindowTokens,
    model,
    modelName,
    modelChoices,
    isLoadingModels,
    onWriteGrantChange,
    onOpenModels,
    onSelectModel,
    onSelectContextWindow,
    onSelectEffort,
    onEnhance,
    onUndoEnhance,
    onSend,
    onStop,
}: AiChatComposerActionsProps): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-0.5">
                <AiChatWriteGrantSwitch grant={writeGrant} disabled={isGenerating} onChange={onWriteGrantChange} />
                <AiChatModelMenu
                    current={model}
                    currentName={modelName}
                    choices={modelChoices}
                    isLoading={isLoadingModels}
                    disabled={isGenerating}
                    onOpen={onOpenModels}
                    onSelect={onSelectModel}
                    onSelectContextWindow={onSelectContextWindow}
                    onSelectEffort={onSelectEffort}
                />
            </div>
            <div className="flex items-center gap-0.5">
                <AiChatTokenRing usage={contextUsage} windowTokens={contextWindowTokens} />
                <EnhanceButton
                    disabled={isGenerating || !canEnhance}
                    isEnhanced={isEnhanced}
                    isBusy={isEnhancing}
                    onEnhance={onEnhance}
                    onUndo={onUndoEnhance}
                />
                <SendButton isGenerating={isGenerating} canSend={canSend} onSend={onSend} onStop={onStop} />
            </div>
        </div>
    )
}
