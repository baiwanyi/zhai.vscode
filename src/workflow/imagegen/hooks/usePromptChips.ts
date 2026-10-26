/**
 * 生图输入芯片：维护「引用意图」集合（作品设定与当前角色），同一 kind 只允许一枚。
 * 复用约定：角色快照类型取 ../prompt/promptSections，本 hook 只产出数据与操作，图标等展示留在 layout 渲染。
 * 关键约束：芯片 id 即 kind，增删都按 kind 判重；角色芯片由角色选择器直接设置（传 null 即清除），不再做开关；
 * 角色芯片的初值取顶栏筛选的角色，之后以选择器的选择为准，两者不联动；
 * 发送时的清空与失败后的草稿回填由 useImageComposer 触发，回填只在用户没有新加芯片时生效。
 */
import { useState } from 'react'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'

/** 徽标：setting 指作品设定，character 指某个人物；画风不进徽标，由底部操作行单选后随请求下发 */
export interface PromptChip {
    kind: 'setting' | 'character'
    value: string
    label: string
}

interface UsePromptChipsOptions {
    /** 初始角色：顶栏筛选值只作初值，之后由角色菜单改写，避免顶栏改筛选把会话内的选择顶掉 */
    initialCharacter: PromptCharacterSnapshot | null
}

interface UsePromptChipsResult {
    chips: PromptChip[]
    settingChip: PromptChip | null
    characterChip: PromptChip | null
    toggleSetting: () => void
    /** 设置角色芯片：传 null 即清除，菜单选择与移除徽标都走这一条 */
    setCharacter: (character: PromptCharacterSnapshot | null) => void
    removeChip: (kind: string) => void
    /** 发送即清空 */
    clearChips: () => void
    /** 草稿回填：只在用户没有新加芯片时生效 */
    restoreChips: (snapshot: readonly PromptChip[]) => void
}

/** 作品设定芯片：value 固定为 setting，与宿主侧的引用口径一致 */
const SETTING_CHIP: PromptChip = { kind: 'setting', value: 'setting', label: '作品设定' }

/** 角色芯片：值取角色 id，文案只放姓名——人物卡语义由渲染层的前置图标表达，文字不重复占位 */
function characterChipOf(character: PromptCharacterSnapshot): PromptChip {
    return { kind: 'character', value: character.id, label: character.name }
}

/** 按 kind 取反：已有则删，没有则追加 */
function toggleChip(chips: PromptChip[], next: PromptChip): PromptChip[] {
    return chips.some((chip) => chip.kind === next.kind)
        ? chips.filter((chip) => chip.kind !== next.kind)
        : [...chips, next]
}

export function usePromptChips({ initialCharacter }: UsePromptChipsOptions): UsePromptChipsResult {
    // 惰性初值：顶栏已选角色时，进入页面就该带着角色徽标，不必再点一次菜单
    const [chips, setChips] = useState<PromptChip[]>(() =>
        initialCharacter === null ? [] : [characterChipOf(initialCharacter)],
    )

    const toggleSetting = (): void => {
        setChips((current) => toggleChip(current, SETTING_CHIP))
    }

    const setCharacter = (character: PromptCharacterSnapshot | null): void => {
        setChips((current) => {
            const rest = current.filter((chip) => chip.kind !== 'character')
            return character === null ? rest : [...rest, characterChipOf(character)]
        })
    }

    const removeChip = (kind: string): void => {
        setChips((current) => current.filter((chip) => chip.kind !== kind))
    }

    const clearChips = (): void => {
        setChips([])
    }

    const restoreChips = (snapshot: readonly PromptChip[]): void => {
        setChips((current) => (current.length > 0 ? current : [...snapshot]))
    }

    return {
        chips,
        settingChip: chips.find((chip) => chip.kind === 'setting') ?? null,
        characterChip: chips.find((chip) => chip.kind === 'character') ?? null,
        toggleSetting,
        setCharacter,
        removeChip,
        clearChips,
        restoreChips,
    }
}
