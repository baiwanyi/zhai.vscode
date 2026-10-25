/**
 * 生图输入卡片的底部操作行：左侧比例菜单，右侧增强与发送。
 * 复用约定：比例菜单取本目录 ImageComposerRatioSwitch，增强与发送取 @webview/components 的
 * EnhanceButton / SendButton（与 aichat 共用同一组图标按钮）。
 * 关键约束：本组件不持有状态，可否增强与可否发送由输入卡片按正文与生成态算好传入；
 * 生成中比例菜单禁用、发送位换为取消，同一位置不会同时出现两个动作。
 */
import type { ImageRatio } from '@shared/types/imagegen'
import { EnhanceButton } from '@webview/components/EnhanceButton'
import { SendButton } from '@webview/components/SendButton'
import { ImageComposerRatioSwitch } from './ImageComposerRatioSwitch'
import type { JSX } from 'react'

interface ImageComposerActionsProps {
    /** 当前比例：交给比例菜单显示与切换 */
    ratio: ImageRatio
    /** 封面模式：发送按钮的可访问名改为「生成封面」 */
    isCoverMode: boolean
    /** 生成中：比例菜单禁用，发送位换成取消 */
    isGenerating: boolean
    /** 增强请求进行中：增强按钮转圈并禁用 */
    isEnhancing: boolean
    /** 正文当前是否为增强结果：决定增强按钮的图标与动作 */
    isEnhanced: boolean
    /** 可否增强：正文为空、生成中或增强中都不可点 */
    canEnhance: boolean
    /** 可否发送：正文与芯片拼装后不为空才可点 */
    canSend: boolean
    onRatioChange: (ratio: ImageRatio) => void
    onEnhance: () => void
    onRestore: () => void
    onSend: () => void
    onAbort: () => void
}

export function ImageComposerActions({
    ratio,
    isCoverMode,
    isGenerating,
    isEnhancing,
    isEnhanced,
    canEnhance,
    canSend,
    onRatioChange,
    onEnhance,
    onRestore,
    onSend,
    onAbort,
}: ImageComposerActionsProps): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-2 pt-1">
            <ImageComposerRatioSwitch ratio={ratio} disabled={isGenerating} onChange={onRatioChange} />
            <div className="flex items-center gap-0.5">
                <EnhanceButton
                    disabled={!canEnhance || isGenerating}
                    isEnhanced={isEnhanced}
                    isBusy={isEnhancing}
                    onEnhance={onEnhance}
                    onUndo={onRestore}
                />
                <SendButton
                    isGenerating={isGenerating}
                    canSend={canSend}
                    sendLabel={isCoverMode ? '生成封面' : '发送'}
                    stopLabel="取消生成"
                    onSend={onSend}
                    onStop={onAbort}
                />
            </div>
        </div>
    )
}
