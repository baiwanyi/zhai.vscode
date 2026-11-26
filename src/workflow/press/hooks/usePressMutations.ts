/**
 * 作品草稿的结构性变更：设定 / 人物 / 大纲的更新、增删、提取合并与打开作品。
 * 复用约定：草稿与写盘取 ./usePressWorkspace，纯函数取 ../utils，作品打开取 @shared/utils/bridge。
 * 关键约束：当前草稿一律经 getWorkspace() 读取；结构性操作立即写盘；章纲写入按实际章序回写线索引用。
 */
import { useCallback } from 'react'
import type {
    OpenPressProjectResult,
    PressExtractedCharacter,
    PressExtractedSetting,
    PressExtractedVolume,
    VolumeOutlineDraft,
} from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { SettingFieldSectionKey } from '../setting/sections'
import type {
    CharacterCard,
    CharacterSeed,
    LoreEntry,
    LoreSeed,
    OutlineChapter,
    OutlineExtractTarget,
    OutlinePlan,
    OutlineSectionKey,
    OutlineVolume,
    OutlineWorkspace,
    ProjectSetting,
} from '../types'
import type { ChapterSeed, VolumeChapterWriteMode } from '../utils'
import type { FlushOptions, PersistScope } from './usePressWorkspace'
import { SETTING_SECTIONS } from '../setting/sections'
import {
    buildClueRefPatches,
    createChapter,
    createChaptersFromSeeds,
    createCharacterCard,
    createLoreEntry,
    createOutlineFromDraft,
    createVolume,
    isEmptyOutlineChapter,
    mergeCharacterDrafts,
    readOutlineVolumeOrder,
    refreshOutlineChapters,
    renumberChapters,
} from '../utils'

/** 新增卷 / 章后的落点：卷 id 与章 id 供页面直接选中，章 id 在空卷时为 null */
export interface CreatedOutlineNode {
    volumeId: string
    chapterId: string | null
}

/** 空章判定：与 utils 的 isEmptyOutlineChapter 同一口径，替换模式只清掉这类章节 */
const isEmptyChapter = isEmptyOutlineChapter

export interface PressMutations {
    openProject: (dirPath: string) => void
    updateSetting: (patch: Partial<ProjectSetting>) => void
    /** 保存字段分组：把当前标签页写进它对应的文档，结束后 resolve */
    saveSettingSection: (section: SettingFieldSectionKey) => Promise<void>
    /** 静默保存多个字段分组：供切页自动保存使用，不发成功提示以免一次切页弹多条 */
    flushSettingSections: (sections: SettingFieldSectionKey[]) => Promise<void>
    /**
     * 人物卡改动并立即写盘。
     * silent 为 true 时不发成功提示：媒体页认领封面属于系统行为，
     * 弹一句「已保存人物卡」会让人误以为是自己刚保存过。
     */
    updateCharacter: (characterId: string, patch: Partial<CharacterCard>, options?: { silent?: boolean }) => void
    deleteCharacter: (characterId: string) => void
    createCharacter: (seed: CharacterSeed) => string
    extractCharacters: (drafts: PressExtractedCharacter[]) => { created: number; updated: number }
    /** 新建资料条目并返回标识：条目页据此直接打开编辑弹窗 */
    createLore: (seed: LoreSeed) => string
    updateLore: (loreId: string, patch: Partial<LoreEntry>) => void
    /** 删除条目：同步清理它的设定图，所属文档里的条目块一并移除 */
    deleteLore: (loreId: string) => void
    updateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    /** 更新卷纲字段：卷名、核心事件、情节脉络等在卷纲视图里编辑，走防抖写盘 */
    updateVolume: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /**
     * 按卷写入 AI 生成的章纲：append 追加到卷末，replace-empty 先清掉未动过的空章再续排。
     * 写入后整卷章序规整为 1..N，返回实际写入的章数。
     */
    applyVolumeChapters: (volumeId: string, seeds: readonly ChapterSeed[], mode: VolumeChapterWriteMode) => number
    /** 更新某个功能模块段落：只写该段对应的段落，其余段落保持原样 */
    updateOutlinePlan: (section: OutlineSectionKey, patch: Partial<OutlinePlan>) => void
    /** 立即写盘的大纲整批更新：回填一次改多段（卷章 + 线索等）时使用 */
    applyOutlineChange: (next: { volumes?: OutlineVolume[]; plan?: OutlinePlan }) => void
    /** 新增一卷（含一条空章纲）：只长大纲草稿，不建章节文件，返回落点供页面选中 */
    createOutlineVolume: () => CreatedOutlineNode | null
    /** 新增一章：落到指定卷（缺省为最后一卷），返回落点供页面选中 */
    createOutlineChapter: (volumeId?: string) => CreatedOutlineNode | null
    /**
     * 写入 AI 生成的卷纲：按卷序覆盖现有卷纲字段（章节保留），多出的草案追加为新卷。
     * 返回实际写入的卷数。
     */
    applyVolumeOutlines: (drafts: readonly VolumeOutlineDraft[]) => number
    /** 用素材重建大纲：mode 为 all 时整树覆盖，chapters 时按「卷序 + 卷内位置」刷新所选章，返回实际处理的章数 */
    extractOutline: (drafts: PressExtractedVolume[], target: OutlineExtractTarget) => number
    extractSetting: (draft: PressExtractedSetting) => number
}

interface MutationsDeps {
    getWorkspace: () => OutlineWorkspace | null
    updateWorkspace: (recipe: (previous: OutlineWorkspace) => OutlineWorkspace) => void
    flush: (scopes: Set<PersistScope>, options?: FlushOptions) => Promise<void>
    /** 防抖写盘：大纲可指定只写哪些段落，不传即整体落盘 */
    scheduleFlush: (scope: PersistScope, outlineSections?: readonly OutlineSectionKey[]) => void
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

    /** 设定字段改动：只更新内存草稿，落盘由设定页的保存按钮按当前标签页触发 */
    const updateSetting = useCallback(
        (patch: Partial<ProjectSetting>): void => {
            updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
        },
        [updateWorkspace],
    )

    /** 保存字段分组：只把当前标签页写进它对应的文档，成功提示由 flush 统一发出 */
    const saveSettingSection = useCallback(
        (section: SettingFieldSectionKey): Promise<void> => {
            const meta = SETTING_SECTIONS[section]
            return flush(new Set<PersistScope>([section]), {
                successMessage: `「${meta.label}」已保存`,
            })
        },
        [flush],
    )

    /** 静默保存多个字段分组：切页自动保存走这里，只写盘不提示 */
    const flushSettingSections = useCallback(
        (sections: SettingFieldSectionKey[]): Promise<void> => {
            if (sections.length === 0) {
                return Promise.resolve()
            }
            return flush(new Set<PersistScope>(sections))
        },
        [flush],
    )

    /** 人物卡保存：编辑弹窗点保存即写盘，不再依赖手动回写；silent 用于系统侧写回 */
    const updateCharacter = useCallback(
        (characterId: string, patch: Partial<CharacterCard>, options?: { silent?: boolean }): void => {
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.map((character) =>
                    character.id === characterId ? { ...character, ...patch } : character,
                ),
            }))
            const scopes = new Set<PersistScope>(['characters'])
            if (options?.silent === true) {
                void flush(scopes)
                return
            }
            const name = getWorkspace()?.characters.find((character) => character.id === characterId)?.name
            void flush(scopes, { successMessage: name === undefined ? '已保存人物卡' : `已保存「${name}」` })
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
                // 线索的触发者引用人物 id：删除人物时一并清空，避免留下悬空引用
                plan: {
                    ...previous.plan,
                    clues: previous.plan.clues.map((clue) =>
                        clue.triggerId === characterId ? { ...clue, triggerId: '' } : clue,
                    ),
                },
            }))
            void flush(new Set<PersistScope>(['characters', 'outline']), {
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
            void flush(new Set<PersistScope>(['characters']), { successMessage: '已新建人物，后续改动自动保存' })
            return character.id
        },
        [flush, updateWorkspace],
    )

    /** 新建条目并返回标识：条目页据此直接打开编辑弹窗，新条目立即写盘 */
    const createLore = useCallback(
        (seed: LoreSeed): string => {
            const entry = createLoreEntry(seed)
            updateWorkspace((previous) => ({ ...previous, lore: [...previous.lore, entry] }))
            void flush(new Set<PersistScope>([entry.kind]), { successMessage: '已新建条目，后续改动自动保存' })
            return entry.id
        },
        [flush, updateWorkspace],
    )

    /** 条目保存：只写它所属分类的文档，名称、描述与关联人物一起落盘 */
    const updateLore = useCallback(
        (loreId: string, patch: Partial<LoreEntry>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                lore: previous.lore.map((entry) => (entry.id === loreId ? { ...entry, ...patch } : entry)),
            }))
            const entry = getWorkspace()?.lore.find((item) => item.id === loreId)
            void flush(new Set<PersistScope>([entry?.kind ?? 'faction']), {
                successMessage: entry === undefined ? '已保存条目' : `已保存「${entry.name}」`,
            })
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 删除条目：从草稿移除并清理设定图，所属文档里的条目块连同删除名单一起写盘 */
    const deleteLore = useCallback(
        (loreId: string): void => {
            const target = getWorkspace()?.lore.find((entry) => entry.id === loreId) ?? null
            updateWorkspace((previous) => ({
                ...previous,
                lore: previous.lore.filter((entry) => entry.id !== loreId),
            }))
            void flush(new Set<PersistScope>([target?.kind ?? 'faction']), {
                deletedLore: target === null ? undefined : { kind: target.kind, name: target.name, id: target.id },
                successMessage: target === null ? '已删除条目' : `已删除「${target.name}」`,
            })
        },
        [flush, getWorkspace, updateWorkspace],
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
            void flush(new Set<PersistScope>(['characters']))
            return { created: merged.created, updated: merged.updated }
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 章纲字段改动：含标题输入，走防抖写盘；只写「章节内容」段落 */
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
            scheduleFlush('outline', ['chapters'])
        },
        [scheduleFlush, updateWorkspace],
    )

    /**
     * 卷纲字段改动：只写「卷纲」段落。
     * 关键约束：卷名同时出现在卷纲与章节内容的三级标题里，改名两段都要重写，否则两段卷序对不上。
     */
    const updateVolume = useCallback(
        (volumeId: string, patch: Partial<OutlineVolume>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => (volume.id === volumeId ? { ...volume, ...patch } : volume)),
            }))
            const sections: OutlineSectionKey[] =
                patch.name === undefined ? ['volumeOutlines'] : ['volumeOutlines', 'chapters']
            scheduleFlush('outline', sections)
        },
        [scheduleFlush, updateWorkspace],
    )

    /**
     * 按卷写入生成的章纲，并按草案的 clueRefs 回写线索的埋设/回收章；只动这一卷。
     * 关键约束：replace-empty 只清空章、写完整卷规整为 1..N；追加模式接在卷末不重排；
     * 线索引用按写入后的实际章序生成，同一线索多次出现以最后一章为准；回收状态仍由作者确认。
     */
    const applyVolumeChapters = useCallback(
        (volumeId: string, seeds: readonly ChapterSeed[], mode: VolumeChapterWriteMode): number => {
            const current = getWorkspace()
            if (current === null || seeds.length === 0) {
                return 0
            }
            const volumeIndex = current.volumes.findIndex((volume) => volume.id === volumeId)
            const target = current.volumes[volumeIndex]
            if (target === undefined) {
                return 0
            }
            const volumeOrder = readOutlineVolumeOrder(target.name, volumeIndex)
            const kept =
                mode === 'replace-empty'
                    ? target.chapters.filter((chapter) => !isEmptyChapter(chapter))
                    : target.chapters
            // 替换模式随后会整卷重排，起始章序取「保留章数 + 1」；追加模式接在最大章序之后
            const startOrder =
                mode === 'replace-empty'
                    ? kept.length + 1
                    : kept.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
            const cluePatches = buildClueRefPatches(seeds, startOrder, volumeOrder)
            const touchedClues = current.plan.clues.filter((clue) => cluePatches.has(clue.id)).length
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => {
                    if (volume.id !== volumeId) {
                        return volume
                    }
                    const currentKept =
                        mode === 'replace-empty'
                            ? volume.chapters.filter((chapter) => !isEmptyChapter(chapter))
                            : volume.chapters
                    const currentStart =
                        mode === 'replace-empty'
                            ? currentKept.length + 1
                            : currentKept.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
                    const created = createChaptersFromSeeds(seeds, currentStart)
                    const chapters = [...currentKept, ...created]
                    return {
                        ...volume,
                        chapters: mode === 'replace-empty' ? renumberChapters(chapters) : chapters,
                    }
                }),
                plan: {
                    ...previous.plan,
                    clues: previous.plan.clues.map((clue) => {
                        const patch = cluePatches.get(clue.id)
                        if (patch === undefined) {
                            return clue
                        }
                        return {
                            ...clue,
                            plant: patch.plant ?? clue.plant,
                            payoff: patch.payoff ?? clue.payoff,
                        }
                    }),
                },
            }))
            void flush(new Set<PersistScope>(['outline']), {
                outlineSections: ['chapters', 'clues'],
                successMessage:
                    touchedClues > 0
                        ? `已写入 ${String(seeds.length)} 章章纲，${String(touchedClues)} 条线索引用已更新`
                        : `已写入 ${String(seeds.length)} 章章纲`,
            })
            return seeds.length
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 功能模块改动：只落盘该模块对应的段落，避免编辑线索时把卷章整段重写 */
    const updateOutlinePlan = useCallback(
        (section: OutlineSectionKey, patch: Partial<OutlinePlan>): void => {
            updateWorkspace((previous) => ({ ...previous, plan: { ...previous.plan, ...patch } }))
            scheduleFlush('outline', [section])
        },
        [scheduleFlush, updateWorkspace],
    )

    /**
     * 大纲整批更新并立即写盘：写后回填会同时改卷章与线索，
     * 这类操作不能等防抖，否则页面已经显示「已回填」而磁盘还是旧值。
     */
    const applyOutlineChange = useCallback(
        (next: { volumes?: OutlineVolume[]; plan?: OutlinePlan }): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: next.volumes ?? previous.volumes,
                plan: next.plan ?? previous.plan,
            }))
            void flush(new Set<PersistScope>(['outline']), { successMessage: '大纲已更新' })
        },
        [flush, updateWorkspace],
    )

    /**
     * 追加一卷（含首条空章纲）并立即写盘：卷序号按现有卷数续排，卷名沿用 utils 的占位规则。
     * 关键约束：只改大纲草稿，不创建章节文件——大纲是草稿，作品列表才是内容输出。
     */
    const createOutlineVolume = useCallback((): CreatedOutlineNode | null => {
        const current = getWorkspace()
        if (current === null) {
            return null
        }
        const volume = createVolume()
        updateWorkspace((previous) => ({ ...previous, volumes: [...previous.volumes, volume] }))
        void flush(new Set<PersistScope>(['outline']), { successMessage: `已新增「${volume.name}」` })
        const firstChapter = volume.chapters[0] ?? null
        return { volumeId: volume.id, chapterId: firstChapter?.id ?? null }
    }, [flush, getWorkspace, updateWorkspace])

    /**
     * 追加一章并立即写盘：落到指定卷，未指定时落到最后一卷；大纲还没有卷时先补一卷。
     * 关键约束：章序取该卷现有最大章序 + 1，不按数组长度推导——卷内章序允许被作者手工改过。
     */
    const createOutlineChapter = useCallback(
        (volumeId?: string): CreatedOutlineNode | null => {
            const current = getWorkspace()
            if (current === null) {
                return null
            }
            const lastVolume = current.volumes[current.volumes.length - 1]
            if (lastVolume === undefined) {
                // 没有卷就没有章纲的归属：先建一卷，首章即本次新增的章
                return createOutlineVolume()
            }
            const target =
                (volumeId === undefined ? undefined : current.volumes.find((volume) => volume.id === volumeId)) ??
                lastVolume
            const order = target.chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
            const chapter = createChapter(order)
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) =>
                    volume.id === target.id ? { ...volume, chapters: [...volume.chapters, chapter] } : volume,
                ),
            }))
            void flush(new Set<PersistScope>(['outline']), {
                successMessage: `已在「${target.name}」新增一章`,
            })
            return { volumeId: target.id, chapterId: chapter.id }
        },
        [createOutlineVolume, flush, getWorkspace, updateWorkspace],
    )

    /**
     * 写入 AI 生成的卷纲：按卷序覆盖现有卷的卷纲字段，多出的草案追加为新卷。
     * 关键约束：只改卷名与卷纲五项，章节、节拍与场景一律保留；
     * 卷名会同时影响卷纲与章节内容两段，因此整体落盘（不指定段落）。
     */
    const applyVolumeOutlines = useCallback(
        (drafts: readonly VolumeOutlineDraft[]): number => {
            if (drafts.length === 0) {
                return 0
            }
            const current = getWorkspace()
            if (current === null) {
                return 0
            }
            updateWorkspace((previous) => {
                const covered = drafts.map((draft, index) => {
                    const existing = previous.volumes[index]
                    const base = existing ?? createVolume()
                    return {
                        ...base,
                        name: draft.name,
                        expectedChapters: draft.expectedChapters,
                        coreEvent: draft.coreEvent,
                        mainPlot: [...draft.mainPlot],
                        turningPoints: [...draft.turningPoints],
                        result: draft.result,
                    }
                })
                // 草案之外的旧卷原样保留，避免覆盖时连带丢掉已写章节
                return { ...previous, volumes: [...covered, ...previous.volumes.slice(drafts.length)] }
            })
            void flush(new Set<PersistScope>(['outline']), {
                successMessage: `已写入 ${String(drafts.length)} 卷卷纲`,
            })
            return drafts.length
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 用素材重建大纲树：整树覆盖或按章刷新，返回实际处理的章数供页面提示 */
    const extractOutline = useCallback(
        (drafts: PressExtractedVolume[], target: OutlineExtractTarget): number => {
            // 出场人物靠名称匹配人物卡：先拿到当前草稿的人物，重建后的章纲才能直接带出 characterIds
            const characters = getWorkspace()?.characters ?? []
            if (target.mode === 'chapters') {
                // 范围提取：结构沿用现有草稿，只把所选卷章位置的章纲字段换成素材口径
                const current = getWorkspace()
                if (current === null) {
                    return 0
                }
                const { volumes, refreshed } = refreshOutlineChapters(current.volumes, drafts, target.keys, characters)
                updateWorkspace((previous) => ({ ...previous, volumes }))
                void flush(new Set<PersistScope>(['outline']))
                return refreshed
            }
            const volumes = createOutlineFromDraft(drafts, characters)
            const chapterCount = volumes.reduce((total, volume) => total + volume.chapters.length, 0)
            updateWorkspace((previous) => ({ ...previous, volumes }))
            void flush(new Set<PersistScope>(['outline']))
            return chapterCount
        },
        [flush, getWorkspace, updateWorkspace],
    )

    /** 合并设定草案：只填空字段，已有内容一律不动，返回实际填入的字段数；只改草稿，落盘需在各标签页点保存 */
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
            if (current.goldenFingerLimit.length === 0 && draft.goldenFingerLimit.length > 0) {
                patch.goldenFingerLimit = draft.goldenFingerLimit
            }
            if (current.goldenFingerUpgrade.length === 0 && draft.goldenFingerUpgrade.length > 0) {
                patch.goldenFingerUpgrade = draft.goldenFingerUpgrade
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
            }
            return filled
        },
        [getWorkspace, updateWorkspace],
    )

    return {
        openProject,
        updateSetting,
        saveSettingSection,
        flushSettingSections,
        updateCharacter,
        deleteCharacter,
        createCharacter,
        extractCharacters,
        createLore,
        updateLore,
        deleteLore,
        updateChapter,
        updateVolume,
        applyVolumeChapters,
        updateOutlinePlan,
        applyOutlineChange,
        createOutlineVolume,
        createOutlineChapter,
        applyVolumeOutlines,
        extractOutline,
        extractSetting,
    }
}
