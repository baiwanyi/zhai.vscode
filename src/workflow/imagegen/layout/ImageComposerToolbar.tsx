/**
 * 生图输入卡片的工具栏：命令动作菜单、角色选择与提示词入口。
 * 复用约定：命令动作取本目录 ImageCommandMenus，角色选择取本目录 ImageCharacterPicker，
 * 提示词取本目录 ImagePromptPicker。
 * 关键约束：本组件不持有状态，各菜单的选中与禁用由输入卡片按芯片算好传入；
 * 命令动作在生成中仍可切换（只影响下一次请求），角色选择同样只在下次请求生效；
 * 词条只回传点选事件与已选标识，芯片的增删由输入卡片决定；
 * 画面风格不在此列，改由底部操作行的 ImageStylePicker 承载。
 */
import { ImageCharacterPicker } from './ImageCharacterPicker'
import { ImageCommandMenus } from './ImageCommandMenus'
import { ImagePromptPicker } from './ImagePromptPicker'
import type { PromptTag } from '../prompt/promptLibrary'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'
import type { JSX } from 'react'

interface ImageComposerToolbarProps {
    /** 作品设定芯片是否已挂上 */
    isSettingActive: boolean
    /** 可选角色：作品下全部人物卡快照 */
    characters: ReadonlyArray<PromptCharacterSnapshot>
    /** 当前角色芯片指向的角色：null 表示不使用角色 */
    activeCharacterId: string | null
    /** 已挂词条的标识（上游原文）：面板据此回显选中态 */
    selectedPrompts: readonly string[]
    /** 切换作品设定芯片 */
    onToggleSetting: () => void
    /** 选定角色：传 null 表示不使用角色，芯片由输入卡片改写 */
    onSelectCharacter: (character: PromptCharacterSnapshot | null) => void
    /** 点选词条：由输入卡片切换对应芯片 */
    onTogglePrompt: (tag: PromptTag) => void
}

export function ImageComposerToolbar({
    isSettingActive,
    characters,
    activeCharacterId,
    selectedPrompts,
    onToggleSetting,
    onSelectCharacter,
    onTogglePrompt,
}: ImageComposerToolbarProps): JSX.Element {
    return (
        <div className="flex items-center gap-0.5 p-0.5">
            <ImageCommandMenus isSettingActive={isSettingActive} onToggleSetting={onToggleSetting} />
            <ImageCharacterPicker
                characters={characters}
                activeCharacterId={activeCharacterId}
                onSelect={onSelectCharacter}
            />
            <ImagePromptPicker selectedPrompts={selectedPrompts} onToggle={onTogglePrompt} />
        </div>
    )
}
