/**
 * 作品草稿的全部结构性变更：设定 / 人物 / 大纲的字段更新、增删、提取合并与打开作品。
 * 复用约定：草稿读取与写盘由 usePressWorkspace 提供（updateWorkspace 改草稿、flush 立即写、scheduleFlush 防抖写），
 * 新建卷章与合并草案复用 ../utils 的工厂函数，作品打开走 @shared/utils/bridge 的 press/open。
 * 关键约束：所有读取「当前草稿」的地方一律走 getWorkspace()，不能用渲染期快照——提取类操作可能在
 * 异步返回后执行，闭包里的旧数组会把用户刚编辑的内容覆盖掉；结构性操作立即写盘，字段级输入才走防抖。
 */
import { useCallback } from 'react'
import type {
    OpenPressProjectResult,
    PressExtractedCharacter,
    PressExtractedSetting,
    PressExtractedVolume,
} from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type {
    CharacterCard,
    CharacterSeed,
    OutlineChapter,
    OutlineVolume,
    OutlineWorkspace,
    ProjectSetting,
} from '../types'
import type { FlushOptions, PersistScope } from './usePressWorkspace'
import { DEFAULT_CHAPTER_WORD_GOAL } from '../constants'
import {
    createChapter,
    createCharacterCard,
    createOutlineFromDraft,
    createVolume,
    mergeCharacterDrafts,
} from '../utils'

/** 卷名归一：追加生成结果时去掉原有的「第N卷」前缀，避免与既有卷序号冲突 */
const VOLUME_PREFIX_PATTERN = /^第\d+卷\s*/

export interface PressMutations {
    openProject: (dirPath: string) => void
    updateSetting: (patch: Partial<ProjectSetting>) => void
    updateCharacter: (characterId: string, patch: Partial<CharacterCard>) => void
    deleteCharacter: (characterId: string) => void
    createCharacter: (seed: CharacterSeed) => string
    extractCharacters: (drafts: PressExtractedCharacter[]) => { created: number; updated: number }
    updateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    /** 新增卷：命名与默认目标字数由工厂函数决定后立即写盘 */
    addVolume: () => void
    /** 新增章：按该卷现有最大序号追加一章并立即写盘 */
    addChapter: (volumeId: string) => void
    applyOutline: (volumes: OutlineVolume[]) => void
    extractOutline: (drafts: PressExtractedVolume[]) => number
    extractSetting: (draft: PressExtractedSetting) => number
}

interface MutationsDeps {
    getWorkspace: () => OutlineWorkspace | null
    updateWorkspace: (recipe: (previous: OutlineWorkspace) => OutlineWorkspace) => void
    flush: (scopes: Set<PersistScope>, options?: FlushOptions) => void
    scheduleFlush: (scope: PersistScope) => void
}

export function usePressMutations({
    getWorkspace,
    updateWorkspace,
    flush,
    scheduleFlush,
}: MutationsDeps): PressMutations {
    /** 打开作品：宿主打开 README 并广播新的 projectDir，页面随之重新解析文档 */
    const openProject = useCallback((dirPath: string): void => {
        const open = async (): Promise<void> => {
            try {
                await request<OpenPressProjectResult>('press/open', { dirPath })
            } catch (cause) {
                toastError(cause)
            }
        }
        void open()
    }, [])

    /** 设定字段改动：输入频繁，走防抖写盘，停顿后统一落一次 */
    const updateSetting = useCallback(
        (patch: Partial<ProjectSetting>): void => {
            updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
            scheduleFlush('setting')
        },
        [scheduleFlush, updateWorkspace],
    )

    /** 人物卡保存：编辑弹窗点保存即写盘，不再依赖手动回写 */
    const updateCharacter = useCallback(
        (characterId: string, patch: Partial<CharacterCard>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.map((character) =>
                    character.id === characterId ? { ...character, ...patch } : character,
                ),
            }))
            const name = getWorkspace()?.characters.find((character) => character.id === characterId)?.name
            flush(new Set<PersistScope>(['characters']), {
                successMessage: name === undefined ? '已保存人物卡' : `已保存「${name}」`,
            })
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 删除人物：同步清理章纲里的出场引用，并立即写盘——角色块从其文档移除、设定图一并清理 */
    const deleteCharacter = useCallback(
        (characterId: string): void => {
            const target = getWorkspace()?.characters.find((character) => character.id === characterId) ?? null
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.filter((character) => character.id !== characterId),
                volumes: previous.volumes.map((volume) => ({
                    ...volume,
                    chapters: volume.chapters.map((chapter) =>
                        chapter.characterIds.includes(characterId)
                            ? {
                                  ...chapter,
                                  characterIds: chapter.characterIds.filter((id) => id !== characterId),
                              }
                            : chapter,
                    ),
                })),
            }))
            flush(new Set<PersistScope>(['characters', 'outline']), {
                deleted: target === null ? undefined : { name: target.name, id: target.id },
                successMessage: target === null ? '已删除人物' : `已删除「${target.name}」`,
            })
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 建卡并返回新卡 id：人物页据此直接下钻到新人物详情，新卡立即写盘 */
    const createCharacter = useCallback(
        (seed: CharacterSeed): string => {
            const character = createCharacterCard(seed)
            updateWorkspace((previous) => ({ ...previous, characters: [...previous.characters, character] }))
            flush(new Set<PersistScope>(['characters']), { successMessage: '已新建人物，后续改动自动保存' })
            return character.id
        },
        [flush, updateWorkspace],
    )

    /**
     * 合并提取出的人物卡：同名人物按空字段补全（不覆盖作者已写内容），未匹配的按草案新建。
     * 关键约束：提取期间列表可能已被编辑，故以写入前的最新草稿再合并一次；
     * 没有任何实际变化时不写盘，避免一次「提取」把没动过的角色设定重写一遍。
     */
    const extractCharacters = useCallback(
        (drafts: PressExtractedCharacter[]): { created: number; updated: number } => {
            const current = getWorkspace()
            if (current === null) {
                return { created: 0, updated: 0 }
            }
            let merged = mergeCharacterDrafts(current.characters, drafts)
            updateWorkspace((previous) => {
                merged = mergeCharacterDrafts(previous.characters, drafts)
                return merged.created === 0 && merged.updated === 0
                    ? previous
                    : { ...previous, characters: merged.characters }
            })
            if (merged.created === 0 && merged.updated === 0) {
                return { created: 0, updated: 0 }
            }
            flush(new Set<PersistScope>(['characters']))
            return { created: merged.created, updated: merged.updated }
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 章纲字段改动：含标题输入，走防抖写盘 */
    const updateChapter = useCallback(
        (chapterId: string, patch: Partial<OutlineChapter>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => ({
                    ...volume,
                    chapters: volume.chapters.map((chapter) =>
                        chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
                    ),
                })),
            }))
            scheduleFlush('outline')
        },
        [scheduleFlush, updateWorkspace],
    )

    const addVolume = useCallback((): void => {
        updateWorkspace((previous) => ({
            ...previous,
            volumes: [...previous.volumes, createVolume(previous.volumes.length + 1, DEFAULT_CHAPTER_WORD_GOAL)],
        }))
        flush(new Set<PersistScope>(['outline']))
    }, [flush, updateWorkspace])

    const addChapter = useCallback(
        (volumeId: string): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => {
                    if (volume.id !== volumeId) {
                        return volume
                    }
                    const nextOrder = volume.chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
                    return {
                        ...volume,
                        chapters: [...volume.chapters, createChapter(nextOrder, DEFAULT_CHAPTER_WORD_GOAL)],
                    }
                }),
            }))
            flush(new Set<PersistScope>(['outline']))
        },
        [flush, updateWorkspace],
    )

    const applyOutline = useCallback(
        (volumes: OutlineVolume[]): void => {
            updateWorkspace((previous) => {
                const offset = previous.volumes.length
                const appended = volumes.map((volume, index) => ({
                    ...volume,
                    name: `第${offset + index + 1}卷 ${volume.name.replace(VOLUME_PREFIX_PATTERN, '') || '新卷'}`,
                }))
                return { ...previous, volumes: [...previous.volumes, ...appended] }
            })
            flush(new Set<PersistScope>(['outline']))
        },
        [flush, updateWorkspace],
    )

    /** 用素材重建大纲树：整体覆盖既有草稿，返回重建的章节数供页面提示 */
    const extractOutline = useCallback(
        (drafts: PressExtractedVolume[]): number => {
            // 出场人物靠名称匹配人物卡：先拿到当前草稿的人物，重建后的章纲才能直接带出 characterIds
            const characters = getWorkspace()?.characters ?? []
            const volumes = createOutlineFromDraft(drafts, DEFAULT_CHAPTER_WORD_GOAL, characters)
            const chapterCount = volumes.reduce((total, volume) => total + volume.chapters.length, 0)
            updateWorkspace((previous) => ({ ...previous, volumes }))
            flush(new Set<PersistScope>(['outline']))
            return chapterCount
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 合并设定草案：只填空字段，已有内容一律不动，返回实际填入的字段数 */
    const extractSetting = useCallback(
        (draft: PressExtractedSetting): number => {
            const current = getWorkspace()?.setting
            if (current === undefined) {
                return 0
            }
            const patch: Partial<ProjectSetting> = {}
            if (current.logline.length === 0 && draft.logline.length > 0) {
                patch.logline = draft.logline
            }
            if (current.conflict.length === 0 && draft.conflict.length > 0) {
                patch.conflict = draft.conflict
            }
            if (current.worldview.length === 0 && draft.worldview.length > 0) {
                patch.worldview = draft.worldview
            }
            if (current.geography.length === 0 && draft.geography.length > 0) {
                patch.geography = draft.geography
            }
            if (current.era.length === 0 && draft.era.length > 0) {
                patch.era = draft.era
            }
            if (current.factions.length === 0 && draft.factions.length > 0) {
                patch.factions = draft.factions
            }
            if (current.powerSystem.length === 0 && draft.powerSystem.length > 0) {
                patch.powerSystem = draft.powerSystem
            }
            if (current.concepts.length === 0 && draft.concepts.length > 0) {
                patch.concepts = draft.concepts
            }
            if (current.taboo.length === 0 && draft.taboo.length > 0) {
                patch.taboo = draft.taboo
            }
            if (current.goldenFingerType.length === 0 && draft.goldenFingerType.length > 0) {
                patch.goldenFingerType = draft.goldenFingerType
            }
            if (current.goldenFingerAbility.length === 0 && draft.goldenFingerAbility.length > 0) {
                patch.goldenFingerAbility = draft.goldenFingerAbility
            }
            if (current.goldenFingerCost.length === 0 && draft.goldenFingerCost.length > 0) {
                patch.goldenFingerCost = draft.goldenFingerCost
            }
            if (current.perspective.length === 0 && draft.perspective.length > 0) {
                patch.perspective = draft.perspective
            }
            if (current.tone.length === 0 && draft.tone.length > 0) {
                patch.tone = draft.tone
            }
            const genres = [...new Set([...current.genres, ...draft.genres])]
            if (genres.length > current.genres.length) {
                patch.genres = genres
            }
            const filled = Object.keys(patch).length
            if (filled > 0) {
                updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
                scheduleFlush('setting')
            }
            return filled
        },
        [getWorkspace, scheduleFlush, updateWorkspace],
    )

    return {
        openProject,
        updateSetting,
        updateCharacter,
        deleteCharacter,
        createCharacter,
        extractCharacters,
        updateChapter,
        addVolume,
        addChapter,
        applyOutline,
        extractOutline,
        extractSetting,
    }
}
