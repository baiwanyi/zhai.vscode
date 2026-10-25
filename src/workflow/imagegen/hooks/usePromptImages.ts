/**
 * 提示词预览图基址：向宿主取图库目录的 webview 地址与本地绝对路径，供词条缩略图与空态提示使用。
 * 复用约定：请求走 @shared/utils/bridge（方法名受 HostMethodName 约束），由调用方在面板打开时触发 reload。
 * 关键约束：不在挂载时自动请求——面板没打开就没有图要显示，挂载即请求会让每次渲染都多一条无用协议；
 * 图库全局共享、与作品无关，不随作品切换重建；取图失败按「没有图」处理且不弹错误，
 * 预览图只是辅助信息，缺图时面板照常可用；baseUrl 为 null 时调用方必须整体隐藏缩略图。
 */
import { useCallback, useState } from 'react'
import type { PromptImageBase } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'

/** 未取到与无图时共用的空基址：dirPath 为空串表示尚未回包 */
const EMPTY_BASE: PromptImageBase = { baseUrl: null, dirPath: '' }

interface UsePromptImagesResult {
    /** 预览图基址，null 表示目录为空：调用方据此隐藏缩略图 */
    baseUrl: string | null
    /** 图库目录绝对路径，空态展示用；空串表示尚未回包 */
    dirPath: string
    /** 取一次基址：面板打开时调用，用户中途放入图片后重新打开即可看到缩略图 */
    reload: () => Promise<void>
}

export function usePromptImages(): UsePromptImagesResult {
    const [base, setBase] = useState<PromptImageBase>(EMPTY_BASE)

    const reload = useCallback(async (): Promise<void> => {
        try {
            setBase(await request<PromptImageBase>('pressAi/getPromptImageBase'))
        } catch {
            setBase(EMPTY_BASE)
        }
    }, [])

    return { baseUrl: base.baseUrl, dirPath: base.dirPath, reload }
}
