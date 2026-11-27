/**
 * 通用防抖回调：输入类高频事件延迟到静默期后执行，卸载时清理在途定时器。
 * 复用约定：回调经 ref 持有，始终调用最新闭包，避免因回调变化重建定时器或捕获旧值；
 * 返回函数引用只随 delayMs 变化，可直接作为 useEffect 依赖或事件处理器使用。
 * 关键约束：定时器句柄在卸载时释放，防止卸载后 setState；delayMs 非有限数按 0 处理，
 * 避免 setTimeout 收到 NaN 被当成 0 而失去防抖语义。
 */
import { useCallback, useEffect, useRef } from 'react'

/** 可防抖的函数：参数与返回值交给调用方约束 */
type DebounceCallback = (...args: never[]) => void

/** 延迟执行回调，返回稳定的包装函数 */
export function useDebouncedCallback<T extends DebounceCallback>(
    callback: T,
    delayMs: number,
): (...args: Parameters<T>) => void {
    const callbackRef = useRef(callback)
    const timerRef = useRef<number | null>(null)
    const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0

    useEffect(() => {
        callbackRef.current = callback
    }, [callback])

    useEffect(
        () => (): void => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current)
            }
        },
        [],
    )

    return useCallback(
        (...args: Parameters<T>): void => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current)
            }
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null
                callbackRef.current(...args)
            }, safeDelayMs)
        },
        [safeDelayMs],
    )
}
