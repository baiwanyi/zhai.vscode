/**
 * 关联刷新钩子：页面挂载时按节流跑一次全量对账（磁盘补录 + 引用重建），并提供强制重扫入口。
 * 复用约定：协议 media/rescan；宿主用 media_meta 记录上次扫描时刻，跨会话 5 分钟内不重复解析文档，
 * 刷新走静默模式，扫描完成只换数据，不让整页回到「正在读取」。
 * 关键约束：skipped 为 true 表示落在节流窗口内，不刷新列表也不提示；
 * 扫描失败只提示、不影响已有列表——关联状态是增强信息，不能因此让页面不可用。
 */
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { MediaRescanResult } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 全量扫描是磁盘遍历 + 文档解析，给足超时 */
const RESCAN_TIMEOUT_MS = 120_000

interface UseMediaRescanResult {
    /** 手动重扫：忽略节流窗口，用于「重新扫描关联」入口 */
    rescan: () => void
}

/**
 * @param reload 扫描完成后的刷新动作：传静默刷新，避免整页回到加载态
 */
export function useMediaRescan(reload: () => Promise<void>): UseMediaRescanResult {
    const run = useCallback(
        async (force: boolean): Promise<void> => {
            try {
                const result = await request<MediaRescanResult>(
                    'media/rescan',
                    force ? { force: true } : {},
                    RESCAN_TIMEOUT_MS,
                )
                if (result.skipped) {
                    return
                }
                await reload()
                if (force) {
                    toast.success(
                        `扫描完成：补录 ${String(result.indexed)} 张，纠正 ${String(result.corrected)} 张，${String(result.stale)} 条引用待修复`,
                    )
                }
            } catch (cause) {
                toastError(cause)
            }
        },
        [reload],
    )

    // 挂载即按节流跑一次：首次进入或距上次扫描超过 5 分钟才真正解析文档
    useEffect(() => {
        void run(false)
    }, [run])

    const rescan = useCallback((): void => {
        void run(true)
    }, [run])

    return { rescan }
}
