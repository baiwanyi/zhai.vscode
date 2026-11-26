/**
 * 媒体页封面指针同步：把「删除后回退」与「出图后认领」两类写回收在一处，统一口径。
 * 复用约定：指针写回一律经调用方注入的 onChangeCharacter，本 hook 不直接请求宿主，
 * 角色查找走 useCharacterIndex 产出的 byId 表。
 * 关键约束：写回只在「确有必要」时发生，用户手动选定的封面不能被覆盖——
 * 单张删除仅在宿主回执里明确给出该角色的回退候选时才写回；
 * 批量删除的回退值取剩余列表里该角色最新一张，不采用单张回执（同批里它可能指向马上要被删的图）；
 * 出图认领仅在该角色尚无封面时生效。
 */
import type { MediaItem } from '@shared/types/media'
import type { ImageGenCharacter } from './useCharacterIndex'

interface UseCharacterCoverSyncParams {
    /** 角色索引：按 id 查当前的封面指针 */
    charactersById: ReadonlyMap<string, ImageGenCharacter>
    /** 写回人物卡封面指针：由页面转给人卡模块 */
    onChangeCharacter: (characterId: string, patch: { coverPortraitId: string | null }) => void
}

interface UseCharacterCoverSyncResult {
    /** 出图成功：该角色尚无封面时把新图认领为封面 */
    claimOnGenerated: (image: MediaItem) => void
    /** 单张删除：宿主给出该角色的回退候选时写回，removedId 为被删图片 */
    applyDeleteFallbacks: (fallbacks: Readonly<Record<string, string | null>>, removedId: string) => void
    /** 批量删除：按剩余列表重算受影响角色的封面，避开同批里即将被删的图 */
    syncAfterBatchDelete: (removed: ReadonlyArray<MediaItem>, remaining: ReadonlyArray<MediaItem>) => void
}

export function useCharacterCoverSync({
    charactersById,
    onChangeCharacter,
}: UseCharacterCoverSyncParams): UseCharacterCoverSyncResult {
    const claimOnGenerated = (image: MediaItem): void => {
        const characterId = image.characterId
        if (characterId === null) {
            return
        }
        const target = charactersById.get(characterId)
        if (target === undefined || target.coverPortraitId !== null) {
            return
        }
        onChangeCharacter(characterId, { coverPortraitId: image.id })
    }

    /**
     * 单张删除后的封面回退：宿主在删除回执里按角色给出「剩余最新一张」。
     * 关键约束：宿主只按「被删图带了哪个角色」给出候选，不看当前封面指针；
     * 因此必须先确认该角色的封面正是被删这张才写回——删除一张非封面图不能改写用户手选的封面。
     */
    const applyDeleteFallbacks = (fallbacks: Readonly<Record<string, string | null>>, removedId: string): void => {
        for (const [characterId, nextId] of Object.entries(fallbacks)) {
            const target = charactersById.get(characterId)
            if (target === undefined || target.coverPortraitId !== removedId) {
                continue
            }
            onChangeCharacter(characterId, { coverPortraitId: nextId })
        }
    }

    const syncAfterBatchDelete = (removed: ReadonlyArray<MediaItem>, remaining: ReadonlyArray<MediaItem>): void => {
        /** 已删图 id 集合：封面指针判断要反复命中，先收成集合避免重复扫描 */
        const removedIds = new Set(removed.map((image) => image.id))
        const affectedCharacterIds = new Set(
            removed.flatMap((image) => (image.characterId === null ? [] : [image.characterId])),
        )
        for (const targetId of affectedCharacterIds) {
            const target = charactersById.get(targetId)
            if (target === undefined || target.coverPortraitId === null || !removedIds.has(target.coverPortraitId)) {
                continue
            }
            const nextPortrait = remaining.find((image) => image.characterId === targetId) ?? null
            onChangeCharacter(targetId, { coverPortraitId: nextPortrait === null ? null : nextPortrait.id })
        }
    }

    return { claimOnGenerated, applyDeleteFallbacks, syncAfterBatchDelete }
}
