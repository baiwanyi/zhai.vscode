/**
 * 仪表盘路由外壳：按页内路由渲染概览首页或写作管理页，是仪表盘内唯一的页面切换点。
 * 复用 hooks/useDashboardRoute 取得路由与导航动作；页面组件只接收导航回调，不自行读写 hash。
 * 关键约束：切换页面时旧页面卸载，重新进入会重新拉取数据，避免跨页面共享过期快照。
 */
import { Dashboard } from './dashboard'
import { useDashboardRoute } from './hooks/useDashboardRoute'
import { DashboardPress } from './press/DashboardPress'
import type { JSX } from 'react'

export function DashboardScreen(): JSX.Element {
    const { route, navigate } = useDashboardRoute()

    if (route === '/press') {
        return <DashboardPress onBack={() => navigate('/')} />
    }

    return <Dashboard onNavigate={navigate} />
}
