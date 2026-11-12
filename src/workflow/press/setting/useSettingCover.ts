/**
 * 作品封面展示：按作品目录回读封面，优先取当前选中的一张，未设封面时退回最新一张。
 * 复用约定：回读经 @shared/utils/bridge 的 pressAi/listCover，结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：本模块只读——出图、设封面与删除分别由 useSettingCoverGenerate 与图库组件发起，写完后经 refreshKey 或 reload 重读；
 * 封面指针在宿主侧（与生图页共用），因此任何写操作后都必须回读，不能只改本地状态；
 * 失败经 sonner 提示并保持空态，不向前端抛错误状态。
 */
import { useCallback, useEffect, useState } from 'react'
import type { CoverListResult, PressCover } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface SettingCoverState {
    /** 封面图：回读完成前为 null，与「确实没有封面」靠 isLoading 区分 */
    cover: PressCover | null
    isLoading: boolean
    /** 重新回读：设封面、删除图片后由调用方触发 */
    reload: () => void
}

/**
 * 入参为当前作品目录（press/{作品名}）与外部刷新信号。
 * refreshKey 由页面在生成成功后递增：生成发生在页面层（切分组不卸载），本 hook 无法感知。
 */
export function useSettingCover(dirPath: string, refreshKey = 0): SettingCoverState {
    const [cover, setCover] = useState<PressCover | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [version, setVersion] = useState(0)

    const reload = useCallback((): void => {
        setVersion((previous) => previous + 1)
    }, [])

    // 磁盘与封面指针是唯一事实来源：作品切换、生成完成、设封面与删除后都按目录重读
    useEffect(() => {
        let cancelled = false
        setIsLoading(true)
        const load = async (): Promise<void> => {
            try {
                const result = await request<CoverListResult>('pressAi/listCover', { dirPath })
                if (!cancelled) {
                    setCover(result.covers.find((item) => item.id === result.selectedId) ?? result.covers[0] ?? null)
                }
            } catch (cause) {
                if (!cancelled) {
                    toastError(cause)
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }
        void load()
        return (): void => {
            cancelled = true
        }
    }, [dirPath, refreshKey, version])

    return { cover, isLoading, reload }
}
