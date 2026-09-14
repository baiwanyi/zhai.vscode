/**
 * 移动端断点判定：以 768px 为界返回当前视口是否为移动端。
 * 复用约定：基于 matchMedia 监听视口变化，供 Sidebar 等响应式组件判断布局形态。
 * 关键约束：首次渲染返回 undefined，调用方需容忍短暂的空值；Webview 重建时监听器随组件卸载自动释放。
 */
import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
    const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

    React.useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
        const onChange = () => {
            setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
        }
        mql.addEventListener('change', onChange)
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
        return () => mql.removeEventListener('change', onChange)
    }, [])

    return !!isMobile
}
