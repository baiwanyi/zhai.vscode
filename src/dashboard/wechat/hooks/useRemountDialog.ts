/**
 * 弹窗重挂载状态：每次打开递增 key，让表单回到目标账号的初始值，避免用 effect 同步表单。
 * 复用约定：只管理开关与实例序号，目标数据由调用方持有；关闭不自动清空目标，由调用方按需处理。
 * 关键约束：key 只在 open 时递增，setOpen(true) 不重置表单；列表页关闭保留目标、账号页关闭清空目标两种口径均可复用。
 */
import { useCallback, useMemo, useState } from 'react'

export interface RemountDialogState {
    isOpen: boolean
    key: number
    open: () => void
    close: () => void
    setOpen: (open: boolean) => void
}

export function useRemountDialog(): RemountDialogState {
    const [isOpen, setIsOpen] = useState(false)
    const [key, setKey] = useState(0)

    const open = useCallback((): void => {
        setKey((previous) => previous + 1)
        setIsOpen(true)
    }, [])

    const close = useCallback((): void => {
        setIsOpen(false)
    }, [])

    return useMemo(() => ({ isOpen, key, open, close, setOpen: setIsOpen }), [close, isOpen, key, open])
}
