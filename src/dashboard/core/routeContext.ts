/**
 * 仪表盘页内路由上下文：定义共享路由状态的 Context 与读取 hook，Provider 与页头返回动作都从这里取。
 * 与 Provider 拆成两个文件，使各自只导出一种成员（组件 / 非组件），避免 fast refresh 失效。
 * 关键约束：Context 缺省值为 null，Provider 缺位时 useDashboardRoute 显式抛错而不静默回退——
 * 静默新建一份状态会让同一页出现两个路由事实源。
 */
import { createContext, use } from 'react'
import type { DashboardRoute } from './routing'

export interface DashboardRouteState {
    route: DashboardRoute
    navigate: (route: DashboardRoute) => void
}

/** 共享路由状态：只由 DashboardRouteProvider 提供，消费方一律走 useDashboardRoute */
export const DashboardRouteContext = createContext<DashboardRouteState | null>(null)

/** 读取共享路由状态：必须在 DashboardRouteProvider 内使用 */
export function useDashboardRoute(): DashboardRouteState {
    const state = use(DashboardRouteContext)
    if (state === null) {
        throw new Error('useDashboardRoute 必须在 DashboardRouteProvider 内使用')
    }
    return state
}
