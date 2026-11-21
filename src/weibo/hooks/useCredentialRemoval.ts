/**
 * 删除登录 Cookie：确认框开关、在途单飞与清除回调集中在此。
 * 复用约定：清除动作由调用方注入（时间线控制器），成功后经 onCleared 通知页面回退视图。
 * 关键约束：确认框的禁用要等下一帧生效，同帧连点靠 ref 挡住；
 * 失败保留确认框（原因由清除动作自己 toast），成功才收起。
 */
import { useCallback, useRef, useState } from 'react'

export interface UseCredentialRemovalOptions {
    /** 清除登录态：返回是否清除成功 */
    clearCredential: () => Promise<boolean>
    /** 清除成功后的导航（页面回首页，让凭证卡自然出现） */
    onCleared: () => void
}

export interface CredentialRemoval {
    isDeleteOpen: boolean
    isDeleting: boolean
    requestDelete: () => void
    setDeleteOpen: (open: boolean) => void
    confirmDelete: () => Promise<void>
}

export function useCredentialRemoval({ clearCredential, onCleared }: UseCredentialRemovalOptions): CredentialRemoval {
    const [isDeleteOpen, setIsDeleteOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const isDeletingRef = useRef(false)

    const requestDelete = useCallback((): void => {
        setIsDeleteOpen(true)
    }, [])

    const confirmDelete = useCallback(async (): Promise<void> => {
        if (isDeletingRef.current) {
            return
        }
        isDeletingRef.current = true
        setIsDeleting(true)
        try {
            const isCleared = await clearCredential()
            if (!isCleared) {
                return
            }
            onCleared()
            setIsDeleteOpen(false)
        } finally {
            isDeletingRef.current = false
            setIsDeleting(false)
        }
    }, [clearCredential, onCleared])

    return { isDeleteOpen, isDeleting, requestDelete, setDeleteOpen: setIsDeleteOpen, confirmDelete }
}
