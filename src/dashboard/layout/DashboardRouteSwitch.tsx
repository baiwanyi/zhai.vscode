/**
 * 仪表盘路由分派：按页内路由渲染概览首页、作品列表与详情、公众号列表与批次页、回收站。
 * 复用 ../core/routing 的路由工厂构造子页面回调，子页面只接收导航回调，不自行读写 hash。
 * 关键约束：作品详情以 dirPath、公众号批次页以 accountId 作 key，切换对象即重挂载，
 * 分批渲染计数与滚动位置随之重置；未登记的路由名一律回概览首页。
 */
import type { DashboardRoute } from '../core/routing'
import type { JSX } from 'react'
import { createPressProjectRoute, createPressRoute, createWechatAccountRoute, createWechatRoute } from '../core/routing'
import { Dashboard } from '../dashboard'
import { DashboardPress } from '../press/DashboardPress'
import { DashboardPressProject } from '../press/DashboardPressProject'
import { DashboardTrash } from '../trash/DashboardTrash'
import { DashboardWechat } from '../wechat/DashboardWechat'
import { DashboardWechatPost } from '../wechat/DashboardWechatPost'

interface DashboardRouteSwitchProps {
    route: DashboardRoute
    onNavigate: (route: DashboardRoute) => void
}

export function DashboardRouteSwitch({ route, onNavigate }: DashboardRouteSwitchProps): JSX.Element {
    switch (route.name) {
        case 'pressProject':
            return (
                <DashboardPressProject
                    key={route.dirPath}
                    dirPath={route.dirPath}
                    onBack={() => onNavigate(createPressRoute())}
                />
            )
        case 'trash':
            return <DashboardTrash />
        case 'press':
            return <DashboardPress onOpenProject={(dirPath) => onNavigate(createPressProjectRoute(dirPath))} />
        case 'wechat':
            return <DashboardWechat onOpenAccount={(accountId) => onNavigate(createWechatAccountRoute(accountId))} />
        case 'wechatAccount':
            // 账号切换即重挂载：批次列表按账号重新取数，不沿用上一个账号的快照
            return (
                <DashboardWechatPost
                    key={route.accountId}
                    accountId={route.accountId}
                    onRemoved={() => onNavigate(createWechatRoute())}
                />
            )
        default:
            return <Dashboard onNavigate={onNavigate} />
    }
}
