/**
 * 角色设定图读取：按角色目录回读已落盘的图片，并一次读回作品下全部角色的图，供列表封面与人物卡展示使用。
 * 复用约定：请求经 @shared/utils/bridge；结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：图片落在当前作品的 Portraits 目录下，因此所有请求都带作品目录，切换作品后不会串图；
 * listGallery 一次读回全部角色的图片，供列表卡片显示封面——不要为每张卡单独调用 list，那是 N 次扫盘；
 * 出图、删除与封面指针同步统一在生图页完成，本模块只读不写；
 * 读取失败统一经 sonner 提示并返回空结果，不回传错误状态给组件渲染。
 */
import { useCallback } from 'react'
import type {
    CharacterPortrait,
    PortraitGalleryItem,
    PortraitGalleryResult,
    PortraitListResult,
} from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface CharacterPortraitState {
    /** 扫描角色目录读回已落盘的图片，按生成时间升序；目录不存在返回空数组 */
    list: (characterId: string) => Promise<CharacterPortrait[]>
    /** 一次读回作品下全部角色的图片，键为人物 id：供列表卡片批量显示封面 */
    listGallery: () => Promise<Record<string, PortraitGalleryItem[]>>
}

/** 入参为当前作品目录：角色图读取都限定在该作品下 */
export function useCharacterPortrait(dirPath: string): CharacterPortraitState {
    const list = useCallback(
        async (characterId: string): Promise<CharacterPortrait[]> => {
            try {
                const result = await request<PortraitListResult>('pressAi/listPortraits', { dirPath, characterId })
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
            const result = await request<PortraitGalleryResult>('pressAi/listPortraitGallery', { dirPath })
            return result.galleries
        } catch (cause) {
            // 列表封面属于增强信息：读取失败只提示，不影响卡片本身
            toastError(cause)
            return {}
        }
    }, [dirPath])

    return { list, listGallery }
}
