/**
 * 在线图库删除确认钩子：待删条目、提交中标志、确认与取消收在一处。
 * 复用约定：删除实现由调用方注入（页面传 useStockDownloaded 的 remove），
 * 删除后的副作用（刷新配额）走 onRemoved，本 hook 不直接发协议请求。
 * 关键约束：确认入口用 ref 闸门 + try/finally——只靠 state 判断会在同一帧连点时重复进入，
 * 造成对同一张图二次删除、宿主回「已不存在」的误导提示；isDeleting 供弹窗禁用两个按钮；
 * 删除失败的提示由注入的 remove 负责，本 hook 无论成败都关闭弹窗。
 */
import { useCallback, useRef, useState } from 'react'
import type { StockLocalPhoto } from '@shared/types/stock'

interface UseStockDeleteOptions {
    /** 删除实现：返回是否成功，失败提示由它自己负责 */
    remove: (id: string) => Promise<boolean>
    /** 删除结束后的副作用：刷新配额等 */
    onRemoved: () => void
}

interface UseStockDeleteResult {
    /** 待删除的图片：非空即打开二次确认 */
    pending: StockLocalPhoto | null
    isDeleting: boolean
    /** 请求删除：传入图片即打开确认弹窗 */
    request: (photo: StockLocalPhoto) => void
    /** 关闭确认弹窗（取消或点遮罩） */
    cancel: () => void
    /** 确认删除：结束后关闭弹窗并触发 onRemoved */
    confirm: () => Promise<void>
}

export function useStockDelete({ remove, onRemoved }: UseStockDeleteOptions): UseStockDeleteResult {
    const [pending, setPending] = useState<StockLocalPhoto | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    /** 提交中闸门：ref 比 state 更早生效，挡住同一帧的重复确认 */
    const isBusyRef = useRef(false)

    const request = useCallback((photo: StockLocalPhoto): void => {
        setPending(photo)
    }, [])

    const cancel = useCallback((): void => {
        setPending(null)
    }, [])

    const confirm = useCallback(async (): Promise<void> => {
        if (pending === null || isBusyRef.current) {
            return
        }
        isBusyRef.current = true
        setIsDeleting(true)
        try {
            await remove(pending.id)
            setPending(null)
            onRemoved()
        } finally {
            isBusyRef.current = false
            setIsDeleting(false)
        }
    }, [pending, remove, onRemoved])

    return { pending, isDeleting, request, cancel, confirm }
}
