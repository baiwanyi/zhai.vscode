/**
 * 挂载标记：异步回包到货时组件可能已经卸载，用它决定「还要不要回写状态、弹不弹提示」。
 * 复用约定：页面与卡片会整块替换（切页、刷新、换人），漏掉这一步就会出现幽灵提示；
 * 各 Hook 不再各自维护同款 effect，拿到的 ref 直接读 current。
 * 关键约束：StrictMode 会先卸载再挂载，这里每次进入都重置为 true；
 * 只读 ref、不触发重渲染，卸载后恒为 false，调用方需自行跳过 setState 与 toast。
 */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export function useIsMounted(): RefObject<boolean> {
    const isMountedRef = useRef(true)
    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])
    return isMountedRef
}
