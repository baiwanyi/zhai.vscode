/**
 * 条目设定图读取：单条目列举与整表批量回读，口径与人物卡的 useCharacterPortrait 完全一致。
 * 复用约定：列举走 pressAi/listLoreImages，批量走 pressAi/listLoreGallery，
 * 返回宿主回传的原始结构，不在前端推断归属；错误统一经 toastError 提示。
 * 关键约束：列表封面属于增强信息——读取失败只提示并返回空表，不影响条目卡片与弹窗本身；
 * 图片以磁盘为准，弹窗关闭期间完成的生成同样能被读回。
 */
import { useCallback } from 'react'
import type { CharacterPortrait, PortraitGalleryItem, PortraitGalleryResult, PortraitListResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

interface UseLoreImagesResult {
    /** 列举单个条目的设定图：最新在前，失败返回空表 */
    list: (loreId: string) => Promise<CharacterPortrait[]>
    /** 一次读回全部条目的封面：按条目标识分组，失败返回空表 */
    listGallery: () => Promise<Record<string, PortraitGalleryItem[]>>
}

export function useLoreImages(dirPath: string): UseLoreImagesResult {
    const list = useCallback(
        async (loreId: string): Promise<CharacterPortrait[]> => {
            try {
                const result = await request<PortraitListResult>('pressAi/listLoreImages', { dirPath, loreId })
                return result.portraits
            } catch (cause) {
                toastError(cause)
                return []
            }
        },
        [dirPath],
    )

    const listGallery = useCallback(async (): Promise<Record<string, PortraitGalleryItem[]>> => {
        try {
            const result = await request<PortraitGalleryResult>('pressAi/listLoreGallery', { dirPath })
            return result.galleries
        } catch (cause) {
            // 列表封面属于增强信息：读取失败只提示，不影响卡片本身
            toastError(cause)
            return {}
        }
    }, [dirPath])

    return { list, listGallery }
}
