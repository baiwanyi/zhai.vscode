/**
 * 生图输入卡片的底部操作行：左侧比例与画面风格，右侧增强与发送。
 * 复用约定：比例菜单取本目录 ImageRatioSelector，画面风格取本目录 ImageStylePicker，
 * 增强与发送取 @webview/components 的 EnhanceButton / SendButton（与 aichat 共用同一组图标按钮）。
 * 关键约束：本组件不持有渲染状态，可否增强与可否发送由输入卡片按正文与生成态算好传入；
 * 发送套一层点击冷却（ref 记时间戳，不触发渲染）：首击后按钮即刻换成取消，连点的第二下若落到那一刻的
 * 取消位上会误取消刚发出的请求，冷却期内直接丢弃；
 * 增强与还原、取消都不过冷却——它们各自受 isBusy / 禁用态保护，且同位置切换频繁，冷却会误吞正常操作；
 * 画风只记录选用结果，不参与正文展示，由输入卡片在发送时并入提示词；
 * 生成中比例菜单与画面风格禁用、发送位换为取消，同一位置不会同时出现两个动作。
 */
import { useRef } from 'react'
import type { ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { EnhanceButton } from '@webview/components/EnhanceButton'
import { SendButton } from '@webview/components/SendButton'
import { ImageRatioSelector } from './ImageRatioSelector'
import { ImageStylePicker } from './ImageStylePicker'
import type { JSX } from 'react'

/** 发送后的冷静期：首击后按钮即刻换成取消，连点的第二下会落到这个位置，这段窗口内忽略取消点击 */
const CLICK_COOLDOWN_MS = 300

interface ImageComposerActionsProps {
    /** 当前比例：交给比例菜单显示与切换 */
    ratio: ImageRatio
    /** 当前画风：交给画面风格面板回显选中项 */
    style: PortraitStyle
    /** 封面模式：发送按钮的可访问名改为「生成封面」 */
    isCoverMode: boolean
    /** 生成中：比例菜单与画面风格禁用，发送位换成取消 */
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
    onStyleChange: (style: PortraitStyle) => void
    onEnhance: () => void
    onRestore: () => void
    onSend: () => void
    onAbort: () => void
}

export function ImageComposerActions({
    ratio,
    style,
    isCoverMode,
    isGenerating,
    isEnhancing,
    isEnhanced,
    canEnhance,
    canSend,
    onRatioChange,
    onStyleChange,
    onEnhance,
    onRestore,
    onSend,
    onAbort,
}: ImageComposerActionsProps): JSX.Element {
    /** 上一次发送的时间戳：ref 不参与渲染，只用于冷却判定，故不违反「不持有状态」 */
    const lastSendAtRef = useRef(0)

    /** 发送：先记时间戳，冷却窗口从这一下开始算 */
    const handleSendClick = (): void => {
        lastSendAtRef.current = Date.now()
        onSend()
    }

    /** 取消：发送后冷却窗口内忽略，连点的第二下不会把刚发出的请求取消掉 */
    const handleStopClick = (): void => {
        if (Date.now() - lastSendAtRef.current < CLICK_COOLDOWN_MS) {
            return
        }
        onAbort()
    }

    return (
        <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-0.5">
                <ImageRatioSelector ratio={ratio} disabled={isGenerating} onChange={onRatioChange} />
                <ImageStylePicker value={style} disabled={isGenerating} onChange={onStyleChange} />
            </div>
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
                    onSend={handleSendClick}
                    onStop={handleStopClick}
                />
            </div>
        </div>
    )
}
