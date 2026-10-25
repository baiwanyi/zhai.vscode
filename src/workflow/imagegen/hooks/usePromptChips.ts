/**
 * 生图输入芯片：维护「引用意图」集合（作品设定与当前角色），同一 kind 只允许一枚。
 * 复用约定：角色快照类型取 ../prompt/promptSections，本 hook 只产出数据与操作，图标等展示留在 layout 渲染。
 * 关键约束：芯片 id 即 kind，增删都按 kind 判重；角色未选中时挂角色芯片为空操作；
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
    /** 顶栏选中的角色：既是生成目标，也是角色徽标的来源 */
    activeCharacter: PromptCharacterSnapshot | null
}

interface UsePromptChipsResult {
    chips: PromptChip[]
    settingChip: PromptChip | null
    characterChip: PromptChip | null
    toggleSetting: () => void
    toggleCharacter: () => void
    /** 补挂作品设定：封面模式进入时用，已有则不重复追加 */
    ensureSetting: () => void
    removeChip: (kind: string) => void
    /** 发送即清空 */
    clearChips: () => void
    /** 草稿回填：只在用户没有新加芯片时生效 */
    restoreChips: (snapshot: readonly PromptChip[]) => void
}

/** 作品设定芯片：value 固定为 setting，与宿主侧的引用口径一致 */
const SETTING_CHIP: PromptChip = { kind: 'setting', value: 'setting', label: '作品设定' }

/** 按 kind 取反：已有则删，没有则追加 */
function toggleChip(chips: PromptChip[], next: PromptChip): PromptChip[] {
    return chips.some((chip) => chip.kind === next.kind)
        ? chips.filter((chip) => chip.kind !== next.kind)
        : [...chips, next]
}

/** 带作品设定芯片：已存在时原样返回，避免重复追加 */
function withSettingChip(chips: PromptChip[]): PromptChip[] {
    return chips.some((chip) => chip.kind === 'setting') ? chips : [...chips, SETTING_CHIP]
}

export function usePromptChips({ activeCharacter }: UsePromptChipsOptions): UsePromptChipsResult {
    const [chips, setChips] = useState<PromptChip[]>([])

    const toggleSetting = (): void => {
        setChips((current) => toggleChip(current, SETTING_CHIP))
    }

    const toggleCharacter = (): void => {
        if (activeCharacter === null) {
            return
        }
        setChips((current) =>
            toggleChip(current, { kind: 'character', value: activeCharacter.id, label: activeCharacter.name }),
        )
    }

    const ensureSetting = (): void => {
        setChips((current) => withSettingChip(current))
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
        toggleCharacter,
        ensureSetting,
        removeChip,
        clearChips,
        restoreChips,
    }
}
