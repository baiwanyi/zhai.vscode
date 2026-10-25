/**
 * 仪表盘页内路由状态：以地址栏 hash 为唯一事实源，导航与浏览器前进后退都由 hashchange 收敛。
 * 复用 ../core/routing 的解析函数，不引入前端路由库（侧栏只需一级页面切换）。
 * 关键约束：navigate 同时写 hash 与本地状态，保证同一路径重复导航也能触发渲染；
 * hashchange 监听在组件卸载时解除，避免页面重挂载后重复绑定。
 */
import { useCallback, useEffect, useState } from 'react'
import { parseRoute, toHash, type DashboardRoute } from '../core/routing'

export interface DashboardRouteState {
    route: DashboardRoute
    navigate: (route: DashboardRoute) => void
}

export function useDashboardRoute(): DashboardRouteState {
    const [route, setRoute] = useState<DashboardRoute>(() => parseRoute(window.location.hash))

    useEffect(() => {
        const handleHashChange = (): void => {
            setRoute(parseRoute(window.location.hash))
        }
        window.addEventListener('hashchange', handleHashChange)
        return (): void => {
            window.removeEventListener('hashchange', handleHashChange)
        }
    }, [])

    const navigate = useCallback((next: DashboardRoute): void => {
        window.location.hash = toHash(next)
        setRoute(next)
    }, [])

    return { route, navigate }
}
