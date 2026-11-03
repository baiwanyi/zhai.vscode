/**
 * 在线图库「已下载」钩子：列举、年月筛选、删除与插入后的局部插卡。
 * 复用约定：列举走 stock/downloaded（month 为空即全量），删除走 stock/remove，错误经 toastError 提示。
 * 关键约束：磁盘是唯一事实来源——删除成功后从本地列表移除并同步计数，不整页重拉；
 * 插入成功后把新条目插到最前（若列表里还没有），避免「刚插完却在列表里找不到」；
 * 年月切换按宿主返回的年月聚合更新下拉，不在前端推算。
 */
import { useCallback, useEffect, useState } from 'react'
import type { StockDownloadedResult, StockLocalPhoto, StockMonthCount, StockRemoveResult } from '@shared/types/stock'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 空列表：首次加载前与空库时共用 */
const EMPTY_LIBRARY: StockDownloadedResult = { items: [], months: [], total: 0 }

interface UseStockDownloadedResult {
    items: StockLocalPhoto[]
    months: StockMonthCount[]
    total: number
    isLoading: boolean
    month: string | null
    setMonth: (value: string | null) => void
    reload: () => Promise<void>
    remove: (id: string) => Promise<boolean>
    /** 插入成功后的局部插卡：已经在列表里就只更新，不重复插入 */
    prepend: (id: string, path: string, url: string) => void
}

export function useStockDownloaded(): UseStockDownloadedResult {
    const [library, setLibrary] = useState<StockDownloadedResult>(EMPTY_LIBRARY)
    const [month, setMonthState] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const reload = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            const result = await request<StockDownloadedResult>('stock/downloaded', { month })
            setLibrary(result)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [month])

    useEffect(() => {
        void reload()
    }, [reload])

    const setMonth = useCallback((value: string | null): void => {
        setMonthState(value)
    }, [])

    const remove = useCallback(
        async (id: string): Promise<boolean> => {
            try {
                const result = await request<StockRemoveResult>('stock/remove', { id })
                if (!result.removed) {
                    toastError(new Error('删除失败，文件可能被占用或已不存在'))
                    return false
                }
                setLibrary((previous) => ({
                    ...previous,
                    items: previous.items.filter((item) => item.id !== id),
                    total: Math.max(0, previous.total - 1),
                }))
                return true
            } catch (cause) {
                toastError(cause)
                return false
            }
        },
        [],
    )

    /**
     * 插入成功后的局部插卡：宿主只回路径与地址，其余字段按「刚下载」的语义补齐。
     * 关键约束：已在列表里时只更新 url（原本可能是 missing 的灰卡），不产生重复条目。
     */
    const prepend = useCallback((id: string, path: string, url: string): void => {
        setLibrary((previous) => {
            const isExisting = previous.items.some((item) => item.id === id)
            if (isExisting) {
                return {
                    ...previous,
                    items: previous.items.map((item) => (item.id === id ? { ...item, url, missing: false } : item)),
                }
            }
            const monthDir = path.split('/')[1] ?? ''
            const created: StockLocalPhoto = {
                id,
                path,
                url,
                ext: path.split('.').pop() ?? 'jpg',
                byteSize: 0,
                month: `${monthDir.slice(0, 4)}-${monthDir.slice(4, 6)}`,
                width: null,
                height: null,
                alt: '',
                photographer: null,
                downloadedAt: new Date().toISOString(),
                scope: 'general',
                missing: false,
            }
            return {
                items: [created, ...previous.items],
                months: previous.months,
                total: previous.total + 1,
            }
        })
    }, [])

    return { items: library.items, months: library.months, total: library.total, isLoading, month, setMonth, reload, remove, prepend }
}
