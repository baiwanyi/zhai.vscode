/**
 * 仪表盘内的单个返回动作：`home` 恒定回概览首页，`back` 按当前路由回上一级（作品详情→作品列表、作品列表→概览）。
 * 复用 @webview/components/Button 的 icon 尺寸与 tooltip，并自带 AppAction 槽位；
 * 导航经 core/routeContext 取路由与 navigate，调用方只给 kind，不必逐处传 onClick，
 * 多个实例由 AppHeader 的 start 网格依次分列（首个在左、第二个在右）。
 * 关键约束：本组件必须处于 DashboardRouteProvider 之内，缺位时 hook 直接抛错而不是静默回退；
 * 需要两个入口的页面显式写两个实例——组件不强制成对出现，避免同一页渲染两个功能重复的按钮。
 */
import { ChevronLeft, House } from 'lucide-react'
import { useCallback } from 'react'
import { AppAction } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import { useDashboardRoute } from '../core/routeContext'
import { createHomeRoute, createParentRoute } from '../core/routing'

/** 返回目标：home 为仪表盘概览，back 为上一级页面 */
type DashboardBackKind = 'home' | 'back'

interface DashboardBackActionProps {
    /** 返回目标：home 恒定直达概览，back 由当前路由推导上一级 */
    kind: DashboardBackKind
}

/** 两种返回目标的文案与图标：label 同时用作 aria-label 与 tooltip */
const BACK_META: Record<DashboardBackKind, { label: string; icon: LucideIcon }> = {
    home: { label: '返回仪表盘', icon: House },
    back: { label: '返回上一页', icon: ChevronLeft },
}

export function DashboardBackAction({ kind }: DashboardBackActionProps): JSX.Element {
    const { route, navigate } = useDashboardRoute()
    const { label, icon: Icon } = BACK_META[kind]

    /** 落点由 kind 与当前路由共同决定，页面不再下发导航回调 */
    const handleClick = useCallback((): void => {
        navigate(kind === 'home' ? createHomeRoute() : createParentRoute(route))
    }, [kind, navigate, route])

    return (
        <AppAction>
            <Button variant="secondary" size="icon" aria-label={label} tooltip={label} onClick={handleClick}>
                <Icon />
            </Button>
        </AppAction>
    )
}
