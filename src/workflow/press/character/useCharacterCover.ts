/**
 * 角色设定图封面：按角色目录回读图片，优先取人物卡记录的封面，未设封面时退回最新一张。
 * 复用约定：回读经 useCharacterPortrait 的 list，不另拼请求；只在人物或封面变化时扫一次目录。
 * 关键约束：出图与删除都在生图页完成，这里只读不写，也不改人物卡字段；
 * 加载态由「人物 + 封面」组合键判断，组合键一变即视为加载中，避免先闪一次空态；
 * effect 内不同步 setState，取消标记保证旧结果不覆盖新人物。
 */
import { useEffect, useState } from 'react'
import type { CharacterPortrait } from '@shared/types/press'
import { useCharacterPortrait } from './useCharacterPortrait'

export interface CharacterCoverState {
    /** 封面图：回读完成前为 null，与「确实没有图」靠 isLoading 区分 */
    portrait: CharacterPortrait | null
    isLoading: boolean
}

/** 入参为当前作品目录与人物标识：封面只从该作品该角色的目录里取 */
export function useCharacterCover(
    dirPath: string,
    characterId: string,
    coverPortraitId: string | null,
): CharacterCoverState {
    const { list } = useCharacterPortrait(dirPath)
    const [portrait, setPortrait] = useState<CharacterPortrait | null>(null)
    const [loadedKey, setLoadedKey] = useState<string | null>(null)
    const portraitKey = `${characterId}|${coverPortraitId ?? ''}`

    useEffect(() => {
        let cancelled = false
        void list(characterId).then((items) => {
            if (cancelled) {
                return
            }
            setPortrait(items.find((item) => item.id === coverPortraitId) ?? items[0] ?? null)
            setLoadedKey(portraitKey)
        })
        return (): void => {
            cancelled = true
        }
    }, [characterId, coverPortraitId, list, portraitKey])

    return { portrait, isLoading: loadedKey !== portraitKey }
}
