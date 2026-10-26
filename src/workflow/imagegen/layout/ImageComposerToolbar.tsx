/**
 * 生图输入卡片的工具栏：添加上下文菜单、参考图、角色选择与提示词入口。
 * 复用约定：上下文菜单取本目录 ImageCommandMenus，参考图取本目录 ImageReferencePicker，
 * 角色选择取本目录 ImageCharacterPicker，提示词取本目录 ImagePromptPicker。
 * 关键约束：本组件不持有状态，各菜单的选中与禁用由输入卡片按芯片算好传入；
 * 上下文与角色都在生成中仍可切换（只影响下一次请求）；
 * 作品设定与规则挂在「添加上下文」的子菜单里，标识与点选事件同样由输入卡片承担，
 * 规则的改名与删除也只上抛标识，芯片的改写仍留在输入卡片；
 * 参考图只上抛选中结果，芯片与发送都由输入卡片决定；
 * 词条只回传点选事件与已选标识，芯片的增删由输入卡片决定；
 * 画面风格不在此列，改由底部操作行的 ImageStylePicker 承载。
 */
import type { ImageReferenceItem, PromptRule } from '@shared/types/imagegen'
import { ImageCharacterPicker } from './ImageCharacterPicker'
import { ImageCommandMenus } from './ImageCommandMenus'
import { ImagePromptPicker } from './ImagePromptPicker'
import { ImageReferencePicker } from './ImageReferencePicker'
import type { PromptTag } from '../prompt/promptLibrary'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'
import type { JSX } from 'react'

interface ImageComposerToolbarProps {
    /** 作品设定芯片是否已挂上 */
    isSettingActive: boolean
    /** 参考图是否已达上限：参考图按钮据此禁用 */
    isReferenceFull: boolean
    /** 可选角色：作品下全部人物卡快照 */
    characters: ReadonlyArray<PromptCharacterSnapshot>
    /** 当前角色芯片指向的角色：null 表示不使用角色 */
    activeCharacterId: string | null
    /** 已挂词条的标识（上游原文）：面板据此回显选中态 */
    selectedPrompts: readonly string[]
    /** 已挂规则的标识（文件名主干）：子菜单据此回显勾选态 */
    selectedRules: readonly string[]
    /** 切换作品设定芯片 */
    onToggleSetting: () => void
    /** 选定角色：传 null 表示不使用角色，芯片由输入卡片改写 */
    onSelectCharacter: (character: PromptCharacterSnapshot | null) => void
    /** 点选词条：由输入卡片切换对应芯片 */
    onTogglePrompt: (tag: PromptTag) => void
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggleRule: (rule: PromptRule) => void
    /** 规则改名：由输入卡片把已挂芯片换到新标识上 */
    onRenameRule: (previousId: string, rule: PromptRule) => void
    /** 规则被删除：由输入卡片摘掉对应芯片 */
    onRemoveRule: (ruleId: string) => void
    /** 选中参考图：由输入卡片挂成参考芯片 */
    onPickReference: (reference: ImageReferenceItem) => void
}

export function ImageComposerToolbar({
    isSettingActive,
    isReferenceFull,
    characters,
    activeCharacterId,
    selectedPrompts,
    selectedRules,
    onToggleSetting,
    onSelectCharacter,
    onTogglePrompt,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
    onPickReference,
}: ImageComposerToolbarProps): JSX.Element {
    return (
        <div className="flex items-center gap-0.5 p-0.5">
            <ImageCommandMenus
                isSettingActive={isSettingActive}
                selectedRules={selectedRules}
                onToggleSetting={onToggleSetting}
                onToggleRule={onToggleRule}
                onRenameRule={onRenameRule}
                onRemoveRule={onRemoveRule}
            />
            <ImageReferencePicker disabled={isReferenceFull} onPick={onPickReference} />
            <ImageCharacterPicker
                characters={characters}
                activeCharacterId={activeCharacterId}
                onSelect={onSelectCharacter}
            />
            <ImagePromptPicker selectedPrompts={selectedPrompts} onToggle={onTogglePrompt} />
        </div>
    )
}
