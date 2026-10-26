/**
 * 生图输入芯片：维护「引用意图」集合——作品设定、当前角色、已选提示词词条、自定义规则与参考图。
 * 复用约定：角色快照类型取 ../prompt/promptSections，词条类型取 ../prompt/promptLibrary，
 * 规则与参考图类型取 @shared/types/imagegen；本 hook 只产出数据与操作，图标与预览留在 layout 渲染。
 * 关键约束：芯片 id 是删除与 DOM 定位的唯一依据——设定与角色按 kind 唯一，
 * 词条按上游原文去重、规则按标识去重、参考图按磁盘路径去重，三者都可挂多枚；
 * 参考图只记宿主回传的路径、文件名与预览地址，不自行拼路径，也不在发送前读文件；
 * 角色芯片由角色选择器直接设置（传 null 即清除），词条与规则由各自面板点选开关，再点同一项即取消；
 * 规则的改名与删除由菜单侧上抛：改名只改已挂的芯片、不会因此挂上新规则，删除则一并摘掉芯片；
 * 发送时的清空与失败后的草稿回填由 useImageComposer 触发，回填只在用户没有新加芯片时生效。
 */
import { useState } from 'react'
import type { ImageReferenceItem, PromptRule } from '@shared/types/imagegen'
import type { PromptTag } from '../prompt/promptLibrary'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'

/** 芯片来源：setting 指作品设定，character 指某个人物，prompt 指词库词条，rule 指自定义规则，reference 指参考图 */
export type PromptChipKind = 'setting' | 'character' | 'prompt' | 'rule' | 'reference'

/**
 * 徽标：value 是交给宿主的标识——角色取角色 id，词条取上游原文，规则取文件名主干，参考图取磁盘路径；
 * previewUrl 只有参考图携带，供芯片缩略图与悬停预览；
 * 画风不进徽标，由底部操作行单选后随请求下发。
 */
export interface PromptChip {
    id: string
    kind: PromptChipKind
    value: string
    label: string
    /** 参考图的 webview 预览地址：仅 kind 为 reference 时存在 */
    previewUrl?: string
}

interface UsePromptChipsOptions {
    /** 初始角色：顶栏筛选值只作初值，之后由角色菜单改写，避免顶栏改筛选把会话内的选择顶掉 */
    initialCharacter: PromptCharacterSnapshot | null
}

interface UsePromptChipsResult {
    chips: PromptChip[]
    settingChip: PromptChip | null
    characterChip: PromptChip | null
    /** 已选词条芯片：发送时按此逐个交给宿主换取提示词文本 */
    promptChips: PromptChip[]
    /** 已选规则芯片：发送时把标识交给宿主读盘并入 */
    ruleChips: PromptChip[]
    /** 已挂参考图：发送时把路径交给宿主读取为多模态输入 */
    referenceChips: PromptChip[]
    toggleSetting: () => void
    /** 设置角色芯片：传 null 即清除，菜单选择与移除徽标都走这一条 */
    setCharacter: (character: PromptCharacterSnapshot | null) => void
    /** 点选词条：未挂则追加，已挂则移除，同一词条在输入区内只出现一枚 */
    togglePrompt: (tag: PromptTag) => void
    /** 点选规则：同一规则在输入区内只出现一枚，多枚规则按点选顺序并入提示词 */
    toggleRule: (rule: PromptRule) => void
    /** 规则改名：已挂的芯片跟着换到新标识，未挂则保持不挂 */
    renameRule: (previousId: string, rule: PromptRule) => void
    /** 规则被删除：摘掉对应芯片，未挂则无副作用 */
    removeRule: (ruleId: string) => void
    /** 新增参考图：同一路径只挂一枚，重复选择同一张图不会重复出现 */
    addReference: (reference: ImageReferenceItem) => void
    removeChip: (id: string) => void
    /** 发送即清空 */
    clearChips: () => void
    /** 草稿回填：只在用户没有新加芯片时生效 */
    restoreChips: (snapshot: readonly PromptChip[]) => void
}

/** 作品设定芯片：value 固定为 setting，与宿主侧的引用口径一致 */
const SETTING_CHIP: PromptChip = { id: 'setting', kind: 'setting', value: 'setting', label: '作品设定' }

/** 角色芯片：值取角色 id，文案只放姓名——人物卡语义由渲染层的前置图标表达，文字不重复占位 */
function characterChipOf(character: PromptCharacterSnapshot): PromptChip {
    return { id: 'character', kind: 'character', value: character.id, label: character.name }
}

/** 词条芯片：prompt 原文全库唯一，直接作 id 与 value，宿主据此换取归一化文本 */
function promptChipOf(tag: PromptTag): PromptChip {
    return { id: `prompt:${tag.prompt}`, kind: 'prompt', value: tag.prompt, label: tag.name }
}

/** 规则芯片：标识取文件名主干，同一规则可与其他规则同时挂载，标签只放规则名 */
function ruleChipOf(rule: PromptRule): PromptChip {
    return { id: `rule:${rule.id}`, kind: 'rule', value: rule.id, label: rule.name }
}

/** 参考图芯片：id 与 value 都取磁盘路径（同一张图只挂一枚），预览地址仅供展示 */
function referenceChipOf(reference: ImageReferenceItem): PromptChip {
    return {
        id: `reference:${reference.path}`,
        kind: 'reference',
        value: reference.path,
        label: reference.name,
        previewUrl: reference.url,
    }
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

    const togglePrompt = (tag: PromptTag): void => {
        const next = promptChipOf(tag)
        setChips((current) =>
            current.some((chip) => chip.id === next.id)
                ? current.filter((chip) => chip.id !== next.id)
                : [...current, next],
        )
    }

    const toggleRule = (rule: PromptRule): void => {
        const next = ruleChipOf(rule)
        setChips((current) =>
            current.some((chip) => chip.id === next.id)
                ? current.filter((chip) => chip.id !== next.id)
                : [...current, next],
        )
    }

    const renameRule = (previousId: string, rule: PromptRule): void => {
        const previousChipId = `rule:${previousId}`
        setChips((current) =>
            current.some((chip) => chip.id === previousChipId)
                ? current.map((chip) => (chip.id === previousChipId ? ruleChipOf(rule) : chip))
                : current,
        )
    }

    const removeRule = (ruleId: string): void => {
        const chipId = `rule:${ruleId}`
        setChips((current) => current.filter((chip) => chip.id !== chipId))
    }

    /** 参考图只增不减：删除统一走芯片上的移除入口，重复选到同一张图时保持原样 */
    const addReference = (reference: ImageReferenceItem): void => {
        const next = referenceChipOf(reference)
        setChips((current) => (current.some((chip) => chip.id === next.id) ? current : [...current, next]))
    }

    const removeChip = (id: string): void => {
        setChips((current) => current.filter((chip) => chip.id !== id))
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
        promptChips: chips.filter((chip) => chip.kind === 'prompt'),
        ruleChips: chips.filter((chip) => chip.kind === 'rule'),
        referenceChips: chips.filter((chip) => chip.kind === 'reference'),
        toggleSetting,
        setCharacter,
        togglePrompt,
        toggleRule,
        renameRule,
        removeRule,
        addReference,
        removeChip,
        clearChips,
        restoreChips,
    }
}
