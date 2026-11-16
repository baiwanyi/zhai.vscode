/**
 * 二次确认的提交时序：确认后保持弹窗挂载，直到动作落定才决定去留。
 * 复用约定：与 ConfirmDialog 搭配，onOpenChange 直接交给本 Hook 生成，页面不再手写 ref 守卫。
 * 关键约束：任务返回 true 才关闭，false 视为整单失败并保留弹窗供原地重试；
 * 动作在途时忽略 AlertDialogAction 触发的自动关闭请求，isSubmitting 才能真正禁用两个按钮；
 * 一个弹窗实例只绑定一个 Hook 实例，多个弹窗并存时各自创建。
 */
import { useCallback, useRef } from 'react'

export interface ConfirmActionOptions {
    /** 关闭弹窗：用户取消、以及任务判定为已完成时调用 */
    close: () => void
}

export interface ConfirmActionResult {
    /** 交给 ConfirmDialog 的 onOpenChange：动作在途时忽略关闭请求 */
    onOpenChange: (isOpen: boolean) => void
    /** 提交一次确认：任务返回 true 关闭弹窗，false 保留弹窗 */
    confirm: (task: () => Promise<boolean>) => void
}

export function useConfirmAction({ close }: ConfirmActionOptions): ConfirmActionResult {
    /** 待定标记：确认发起后置真，动作落定再复位 */
    const isPendingRef = useRef(false)

    const confirm = useCallback(
        (task: () => Promise<boolean>): void => {
            isPendingRef.current = true
            void task()
                .then((isDone) => {
                    if (isDone) {
                        close()
                    }
                })
                .finally(() => {
                    isPendingRef.current = false
                })
        },
        [close],
    )

    const onOpenChange = useCallback(
        (isOpen: boolean): void => {
            if (!isOpen && !isPendingRef.current) {
                close()
            }
        },
        [close],
    )

    return { onOpenChange, confirm }
}
