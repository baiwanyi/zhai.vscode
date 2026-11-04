/**
 * 在线图库状态钩子：密钥是否已配置、剩余配额、冷却倒计时、已下载总数与当前插入目标。
 * 复用约定：读取走 stock/status，写入走 stock/key/save 与 stock/key/clear，错误经 toastError 提示。
 * 关键约束：宿主只回密钥尾号，本 hook 也不持有明文——输入框里的值在提交后立刻丢弃；
 * 保存失败由宿主回滚，前端只需重新拉一次状态，不做本地乐观改写。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { StockKeyClearResult, StockKeySaveResult, StockStatusResult } from '@shared/types/stock'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

interface UseStockStatusResult {
    status: StockStatusResult | null
    isLoading: boolean
    reload: () => Promise<void>
    /** 保存密钥：返回是否成功，失败时保持弹窗打开 */
    saveKey: (accessKey: string) => Promise<boolean>
    clearKey: () => Promise<void>
}

export function useStockStatus(): UseStockStatusResult {
    const [status, setStatus] = useState<StockStatusResult | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const result = await request<StockStatusResult>('stock/status', {})
            setStatus(result)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    const saveKey = useCallback(
        async (accessKey: string): Promise<boolean> => {
            try {
                const result = await request<StockKeySaveResult>('stock/key/save', { accessKey })
                setStatus((previous) =>
                    previous === null
                        ? previous
                        : { ...previous, configured: result.configured, secretHint: result.secretHint },
                )
                await reload()
                toast.success('Unsplash Access Key 已保存')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            }
        },
        [reload],
    )

    const clearKey = useCallback(async (): Promise<void> => {
        try {
            await request<StockKeyClearResult>('stock/key/clear', {})
            await reload()
            toast.success('已清除 Unsplash Access Key')
        } catch (cause) {
            toastError(cause)
        }
    }, [reload])

    return { status, isLoading, reload, saveKey, clearKey }
}
