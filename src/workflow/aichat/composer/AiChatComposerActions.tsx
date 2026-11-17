/**
 * AI 对话输入卡片底部操作行：左侧模型菜单，右侧上下文圆环、增强提示词与发送 / 停止。
 * 采用普通行容器组合各独立子组件，本层只做布局与禁用态分发。
 * 根节点即 AppComposer 骨架的操作行槽位：flex-1 固化在本层（骨架要求操作行撑满、左右两组各自贴边），
 * className 只留给外层做额外布局微调。
 * 关键约束：生成中除圆环可查看外全部禁用，发送位替换为停止按钮；本层不持有任何会话状态；
 * 工具审批默认逐次确认，写入范围固定为当前文档，页面不再提供范围切换入口。
 */
import { cn } from 'cn'
import type { AiContextUsage } from '@shared/types/aiChat'
import { EnhanceButton } from '@webview/components/EnhanceButton'
import { SendButton } from '@webview/components/SendButton'
import { AiChatModelMenu } from './AiChatModelMenu'
import { AiChatTokenRing } from './AiChatTokenRing'
import type { AiChatModelControl } from '../hooks/useAiChatModelControl'
import type { ComponentProps, JSX } from 'react'

interface AiChatComposerActionsProps extends ComponentProps<'div'> {
    isGenerating: boolean
    /** 全部控件锁定：生成中即锁定 */
    isLocked: boolean
    canSend: boolean
    canEnhance: boolean
    isEnhanced: boolean
    /** 增强请求进行中：按钮转圈并丢弃重复点击 */
    isEnhancing: boolean
    /** 当前会话上下文占用：null 表示本轮还没有产出数据 */
    contextUsage: AiContextUsage | null
    /** 当前模型的上下文窗口：会话尚无占用数据时作为圆环分母 */
    contextWindowTokens: number
    /** 模型控制：当前值、展示名、菜单数据与四个选择动作，由页面统一提供 */
    modelControl: AiChatModelControl
    onEnhance: () => void
    onUndoEnhance: () => void
    onSend: () => void
    onStop: () => void
}

export function AiChatComposerActions({
    className,
    isGenerating,
    isLocked,
    canSend,
    canEnhance,
    isEnhanced,
    isEnhancing,
    contextUsage,
    contextWindowTokens,
    modelControl,
    onEnhance,
    onUndoEnhance,
    onSend,
    onStop,
}: AiChatComposerActionsProps): JSX.Element {
    return (
        <div className={cn('flex min-w-0 flex-1 items-center justify-between gap-2 pt-1', className)}>
            <div className="flex min-w-0 items-center gap-0.5">
                <AiChatModelMenu
                    current={modelControl.current}
                    currentName={modelControl.currentName}
                    isReady={modelControl.isReady}
                    choices={modelControl.choices}
                    isLoading={modelControl.isLoading}
                    disabled={isLocked}
                    onOpen={modelControl.open}
                    onSelect={modelControl.select}
                    onSelectContextWindow={modelControl.selectContextWindow}
                    onSelectEffort={modelControl.selectEffort}
                />
            </div>
            <div className="flex items-center gap-0.5">
                <AiChatTokenRing usage={contextUsage} windowTokens={contextWindowTokens} />
                <EnhanceButton
                    disabled={isLocked || !canEnhance}
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
