/**
 * 作品封面展示：按作品目录回读封面，优先取当前选中的一张，未设封面时退回最新一张。
 * 复用约定：回读经 @shared/utils/bridge 的 pressAi/listCover，结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：出图、设为封面与删除都在生图页完成，这里只读不写，也不改任何设定字段；
 * 只在作品目录变化时扫一次目录，失败经 sonner 提示并保持空态，不向前端抛错误状态。
 */
import { useEffect, useState } from 'react'
import type { CoverListResult, PressCover } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface SettingCoverState {
    /** 封面图：回读完成前为 null，与「确实没有封面」靠 isLoading 区分 */
    cover: PressCover | null
    isLoading: boolean
}

/** 入参为当前作品目录（press/{作品名}）：封面只从该作品的 Images 目录回读 */
export function useSettingCover(dirPath: string): SettingCoverState {
    const [cover, setCover] = useState<PressCover | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // 磁盘是唯一事实来源：作品切换后重新按目录回读，生图页新生成的封面同样可见
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
    }, [dirPath])

    return { cover, isLoading }
}
