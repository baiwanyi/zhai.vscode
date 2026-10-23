/**
 * 仪表盘路由外壳：按页内路由渲染概览首页、作品列表或作品详情，是仪表盘内唯一的页面切换点。
 * 复用 hooks/useDashboardRoute 取得路由与导航动作；页面组件只接收导航回调，不自行读写 hash。
 * 关键约束：详情页以 dirPath 作为 key，切换作品即重挂载，分批渲染计数与滚动位置随之重置；
 * 切换页面时旧页面卸载，重新进入会重新拉取数据，避免跨页面共享过期快照。
 * 全局提示：sonner 的 Toaster 只在本层挂载一次，页面内的操作结果统一用 toast 上报，页面不再自挂；
 * 宿主侧命令结果经 useHostToast 订阅 toast 广播，在本层同样用 sonner 呈现。
 */
import { Toaster } from '@components/ui/sonner'
import { createHomeRoute, createPressProjectRoute, createPressRoute } from './core/routing'
import { Dashboard } from './dashboard'
import { useDashboardRoute } from './hooks/useDashboardRoute'
import { DashboardPress } from './press/DashboardPress'
import { DashboardPressProject } from './press/DashboardPressProject'
import type { JSX } from 'react'
import { useHostToast } from '../hooks/useHostToast'
import { useVscodeTheme } from '../hooks/useVscodeTheme'

export function DashboardScreen(): JSX.Element {
    const { route, navigate } = useDashboardRoute()
    const theme = useVscodeTheme()
    useHostToast()

    const renderPage = (): JSX.Element => {
        switch (route.name) {
            case 'pressProject':
                return (
                    <DashboardPressProject
                        key={route.dirPath}
                        dirPath={route.dirPath}
                        onBack={() => navigate(createPressRoute())}
                    />
                )
            case 'press':
                return (
                    <DashboardPress
                        onBack={() => navigate(createHomeRoute())}
                        onOpenProject={(dirPath) => navigate(createPressProjectRoute(dirPath))}
                    />
                )
            default:
                return <Dashboard onNavigate={navigate} />
        }
    }

    return (
        <>
            {renderPage()}
            <Toaster theme={theme} />
        </>
    )
}
