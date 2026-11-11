/**
 * 在线图库复制钩子：把图片写入系统剪贴板，本地没有文件时由宿主先按默认尺寸下载落盘。
 * 复用约定：请求走 stock/copy，异常统一 toastError；成功回调由页面决定是否刷新已下载列表与配额。
 * 关键约束：与插入一样同一时刻只允许一张在途，避免连点触发重复下载；
 * 平台不支持剪贴板图片时给明确提示，不静默失败。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { StockCopyResult } from '@shared/types/stock'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

interface UseStockCopyOptions {
    /** 复制成功：宿主可能刚完成首次下载，页面据此刷新已下载列表与配额 */
    onCopied?: (id: string) => void
}

interface UseStockCopyResult {
    /** 正在复制的图片标识：卡片据此转圈并禁用连点 */
    copyingId: string | null
    copy: (id: string) => void
}

export function useStockCopy(options?: UseStockCopyOptions): UseStockCopyResult {
    const [copyingId, setCopyingId] = useState<string | null>(null)
    const onCopied = options?.onCopied

    const run = useCallback(
        async (id: string): Promise<void> => {
            setCopyingId(id)
            try {
                const result = await request<StockCopyResult>('stock/copy', { id })
                if (result.copied) {
                    toast.success('图片已复制到剪贴板')
                    onCopied?.(id)
                    return
                }
                toast.error(
                    result.reason === 'unsupported'
                        ? '当前系统不支持复制图片，可改用「插入到文章」'
                        : '复制失败，请重试',
                )
            } catch (cause) {
                toastError(cause)
            } finally {
                setCopyingId(null)
            }
        },
        [onCopied],
    )

    /** 对外只给同步回调：JSX 属性不收返回 Promise 的处理函数 */
    const copy = useCallback(
        (id: string): void => {
            if (copyingId !== null) {
                return
            }
            void run(id)
        },
        [copyingId, run],
    )

    return { copyingId, copy }
}
