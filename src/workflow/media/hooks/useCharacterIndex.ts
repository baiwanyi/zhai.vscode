/**
 * 生图页角色索引：一次遍历同时派生「按 id 查角色」与「按 id 查姓名」两张表。
 * 复用约定：角色快照类型取 ../prompt/promptSections，只在本页范围内使用，不外溢到人物卡模块。
 * 关键约束：封面指针修正、卡片角标、出图认领都按 id 反查，一律走这两张表，
 * 不要在新代码里再对 characters 做线性 find。
 */
import { useMemo } from 'react'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'

/** 生图页角色快照：提示词所需字段之外再补一份封面指针，用于删除与生成后的指针同步 */
export interface ImageGenCharacter extends PromptCharacterSnapshot {
    coverPortraitId: string | null
}

interface CharacterIndex {
    byId: ReadonlyMap<string, ImageGenCharacter>
    names: ReadonlyMap<string, string>
}

export function useCharacterIndex(characters: ReadonlyArray<ImageGenCharacter>): CharacterIndex {
    return useMemo(() => {
        const byId = new Map<string, ImageGenCharacter>()
        const names = new Map<string, string>()
        for (const character of characters) {
            byId.set(character.id, character)
            names.set(character.id, character.name)
        }
        return { byId, names }
    }, [characters])
}
