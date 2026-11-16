/**
 * 二次确认的提交时序：确认后保持弹窗挂载，直到动作落定才决定去留。
 * 复用约定：与 ConfirmDialog 搭配，onOpenChange 直接交给本 Hook 生成，页面不再手写 ref 守卫。
 * 关键约束：任务返回 true 才关闭，false 视为整单失败并保留弹窗供原地重试；
 * 动作在途时忽略 AlertDialogAction 触发的自动关闭请求并拦截重复提交，isSubmitting 才能真正禁用两个按钮；
 * 任务自身负责错误提示，本层只兜底拒绝链，避免未处理的 Promise 拒绝打红控制台；
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
    /** 关闭动作由调用方逐帧传入（多为内联箭头），用 ref 持有最新值，使下面两个回调不随渲染重建 */
    const closeRef = useRef(close)
    closeRef.current = close

    const confirm = useCallback((task: () => Promise<boolean>): void => {
        // 在途期间忽略重复提交：isSubmitting 生效前的一帧内双击不应再发一次重操作
        if (isPendingRef.current) {
            return
        }
        isPendingRef.current = true
        void task()
            .then((isDone) => {
                if (isDone) {
                    closeRef.current()
                }
            })
            // 错误提示由任务自身负责，此处只兜底拒绝链，避免未处理的 Promise 拒绝
            .catch(() => undefined)
            .finally(() => {
                isPendingRef.current = false
            })
    }, [])

    const onOpenChange = useCallback((isOpen: boolean): void => {
        if (!isOpen && !isPendingRef.current) {
            closeRef.current()
        }
    }, [])

    return { onOpenChange, confirm }
}
