/**
 * 生图参数钩子：按作品读取生成参数，并把改动写回作品级配置（press/{作品名}/.zhai/image.json）。
 * 复用约定：读写走 pressAi/getImageSettings 与 pressAi/saveImageSettings，默认值取 @shared/types/imagegen 的
 * DEFAULT_IMAGE_SETTINGS（与宿主同一份）；请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：isLoaded 为 false 时 settings 只是默认值，调用方不得据此提交保存，否则会把作品设置覆盖回默认；
 * 保存结果一律以宿主回传的真实状态为准——非法值已被宿主丢弃，不能按请求值回显；
 * patch 中值为 null 表示取消该键的作品覆盖。
 */
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_IMAGE_SETTINGS } from '@shared/types/imagegen'
import type { ImageSettings, ImageSettingsResult } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 参数补丁：只提交改动项，null 表示取消覆盖 */
export type ImageSettingsPatch = Partial<Record<keyof ImageSettings, ImageSettings[keyof ImageSettings] | null>>

interface UseImageSettingsResult {
    settings: ImageSettings
    /** 是否已按当前作品读完一次：false 时 settings 仍是默认值 */
    isLoaded: boolean
    save: (patch: ImageSettingsPatch) => Promise<void>
}

export function useImageSettings(dirPath: string): UseImageSettingsResult {
    const [settings, setSettings] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS)
    const [isLoaded, setIsLoaded] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const result = await request<ImageSettingsResult>('pressAi/getImageSettings', { dirPath })
            setSettings(result.settings)
        } catch (cause) {
            // 读取失败不阻断出图：沿用默认值，用户仍可正常生成
            toastError(cause)
        } finally {
            setIsLoaded(true)
        }
    }, [dirPath])

    useEffect(() => {
        void reload()
    }, [reload])

    const save = useCallback(
        async (patch: ImageSettingsPatch): Promise<void> => {
            try {
                const result = await request<ImageSettingsResult>('pressAi/saveImageSettings', {
                    dirPath,
                    settings: patch,
                })
                setSettings(result.settings)
            } catch (cause) {
                toastError(cause)
            }
        },
        [dirPath],
    )

    return { settings, isLoaded, save }
}
