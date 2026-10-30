/**
 * 仪表盘页内路由 Provider：路由外壳挂一次，页面与页头返回动作共享同一份路由与导航动作。
 * 复用 ./routing 的解析与序列化纯函数，不引入前端路由库；Context 与读取 hook 见 ./routeContext。
 * 关键约束：地址栏 hash 仍是唯一事实源，navigate 同时写 hash 与本地状态，保证同一路径重复导航也能触发渲染；
 * hashchange 监听随卸载解除，避免页面重挂载后重复绑定。
 */
import { useCallback, useEffect, useState } from 'react'
import { DashboardRouteContext } from './routeContext'
import { parseRoute, toHash } from './routing'
import type { DashboardRoute } from './routing'
import type { JSX, ReactNode } from 'react'

interface DashboardRouteProviderProps {
    children: ReactNode
}

export function DashboardRouteProvider({ children }: DashboardRouteProviderProps): JSX.Element {
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

    return <DashboardRouteContext value={{ route, navigate }}>{children}</DashboardRouteContext>
}
