/**
 * 生图输入卡片的工具栏：命令动作、画面风格、角色设定、作品封面与提示词入口。
 * 复用约定：画面风格取本目录 ImageStylePicker，提示词取本目录 ImagePromptPopover，
 * 按钮取 @webview/components/Button（尺寸 sm，激活态切 secondary 底色）。
 * 关键约束：本组件不持有状态，各开关的激活与否由输入卡片按芯片与模式算好传入；
 * 命令动作在生成中仍可切换（只影响下一次请求），其余开关生成中禁用；
 * 角色设定额外受「是否已选人物」「是否封面模式」限制，禁用原因用 title 说明。
 */
import { Sparkles, UserRound } from 'lucide-react'
import type { PortraitStyle } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { ImagePromptPopover } from './ImagePromptPopover'
import { ImageStylePicker } from './ImageStylePicker'
import type { JSX } from 'react'

interface ImageComposerToolbarProps {
    /** 命令动作芯片是否已挂上 */
    isSettingActive: boolean
    /** 角色芯片是否已挂上 */
    isCharacterActive: boolean
    /** 当前生效的画风：交给画面风格面板回显选中项 */
    style: PortraitStyle
    /** 封面模式：与角色设定互斥 */
    isCoverMode: boolean
    /** 生成中：画面风格与作品封面禁用 */
    isGenerating: boolean
    /** 是否可选角色：没在筛选条选人或已进入封面模式时不可用 */
    canPickCharacter: boolean
    onToggleSetting: () => void
    onStyleChange: (value: PortraitStyle, label: string) => void
    onToggleCharacter: () => void
    onToggleCoverMode: () => void
    onInsertPrompt: (text: string) => void
}

export function ImageComposerToolbar({
    isSettingActive,
    isCharacterActive,
    style,
    isCoverMode,
    isGenerating,
    canPickCharacter,
    onToggleSetting,
    onStyleChange,
    onToggleCharacter,
    onToggleCoverMode,
    onInsertPrompt,
}: ImageComposerToolbarProps): JSX.Element {
    /** 角色按钮不可用的原因：封面模式优先说明，避免用户先去筛选条空找一遍 */
    const characterHint = isCoverMode
        ? '封面不绑定角色，先关闭作品封面模式'
        : canPickCharacter
          ? undefined
          : '先在筛选条选择人物'

    return (
        <div className="flex items-center gap-0.5 p-0.5">
            <Button size="sm" variant={isSettingActive ? 'secondary' : 'ghost'} onClick={onToggleSetting}>
                <Sparkles />
                命令动作
            </Button>
            <ImageStylePicker value={style} disabled={isGenerating} onChange={onStyleChange} />
            <Button
                size="sm"
                variant={isCharacterActive ? 'secondary' : 'ghost'}
                disabled={!canPickCharacter}
                title={characterHint}
                onClick={onToggleCharacter}
            >
                <UserRound />
                角色设定
            </Button>
            <Button
                size="sm"
                variant={isCoverMode ? 'secondary' : 'ghost'}
                disabled={isGenerating}
                title="生成结果会落进图库并自动设为作品封面"
                onClick={onToggleCoverMode}
            >
                作品封面
            </Button>
            <ImagePromptPopover
                trigger={
                    <Button size="sm" variant="ghost">
                        提示词
                    </Button>
                }
                onInsert={onInsertPrompt}
            />
        </div>
    )
}
