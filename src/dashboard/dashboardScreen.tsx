/**
 * 仪表盘路由外壳：按页内路由渲染概览首页、作品列表或作品详情，是仪表盘内唯一的页面切换点。
 * 路由与导航由 core/routeContext 的 Provider 统一提供，页面、页头返回动作与底部入口共享同一份；
 * 页面组件只接收导航回调，不自行读写 hash。
 * 关键约束：详情页以 dirPath 作为 key，切换作品即重挂载，分批渲染计数与滚动位置随之重置；
 * 切换页面时旧页面卸载，重新进入会重新拉取数据，避免跨页面共享过期快照；
 * 作品跟随：打开面板时按活动文档进入该作品详情，之后编辑区切换标签由 press 通道同步；
 * 只在「所属作品发生变化」时导航一次（ref 记录上次跟随值），用户点返回或切到非作品文档不会被弹回，
 * 已在同一作品详情时不重复导航，避免无谓重挂载；
 * 公众号跟随：文档落在 wechat/{appid}/post/ 下时按 AppID 找到本地账号，跳到该账号的推送批次列表；
 * 同样按文档路径去重，用户手动返回列表页后不会被弹回，找不到账号的文档回概览首页；
 * 归属回落：笔记与未保存的 untitled 等索引外文档一律回概览首页；
 * 归属未变化、或焦点不在文本编辑器而没有可判定文档时保持当前页。
 * 全局提示：sonner 的 Toaster 只在本层挂载一次，页面内的操作结果统一用 toast 上报，页面不再自挂；
 * 宿主侧命令结果统一在 Workflow 面板呈现（见 AiChatViewProvider），本层不订阅 toast 广播，避免同一提示弹两次。
 * 活跃笔记：ActiveNoteProvider 只在本层挂一次，路由归属判定与概览页的列表选中态共享同一份，
 * 页面点击回填的选中项因此能立刻参与归属判定，不必等宿主广播回传。
 */
import { useEffect, useRef } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import { DashboardRouteProvider } from './core/DashboardRouteProvider'
import { useDashboardRoute } from './core/routeContext'
import {
    createHomeRoute,
    createPressProjectRoute,
    createPressRoute,
    createWechatAccountRoute,
    createWechatRoute,
    readContentScope,
    readWechatAppId,
} from './core/routing'
import { Dashboard } from './dashboard'
import { ActiveNoteProvider } from './hooks/ActiveNoteProvider'
import { useActiveNote } from './hooks/useActiveNote'
import { useActivePressProject } from './hooks/useActivePressProject'
import { DashboardPress } from './press/DashboardPress'
import { DashboardPressProject } from './press/DashboardPressProject'
import { DashboardWechat } from './wechat/DashboardWechat'
import { DashboardWechatPost } from './wechat/DashboardWechatPost'
import { useWechatAccountByAppId } from './wechat/hooks/useWechatAccountByAppId'
import type { DashboardContentScope } from './core/routing'
import type { JSX } from 'react'

export function DashboardScreen(): JSX.Element {
    return (
        <DashboardRouteProvider>
            <ActiveNoteProvider>
                <DashboardScreenContent />
            </ActiveNoteProvider>
        </DashboardRouteProvider>
    )
}

function DashboardScreenContent(): JSX.Element {
    const { route, navigate } = useDashboardRoute()
    const theme = useVscodeTheme()
    const activeProjectDirPath = useActivePressProject()
    const { activeId: activeDocumentPath, hasEditor } = useActiveNote()
    const followedProjectRef = useRef<string | null>(null)
    /** 已跟随过的公众号文档：同一篇不重复跳转，用户手动点返回即保持，不被弹回账号页 */
    const followedWechatDocRef = useRef<string | null>(null)
    /** 上次内容归属：只在归属真的换了时才决定是否回首页，用户手动进出其它页不会被弹回 */
    const lastScopeRef = useRef<DashboardContentScope | undefined>(undefined)

    const scope = readContentScope(activeDocumentPath, activeProjectDirPath, hasEditor)
    /** 当前文档所属的公众号 AppID：只有 wechat/{appid}/post/ 下的文档能解析出来 */
    const wechatAppId = readWechatAppId(activeDocumentPath)
    /** 对应账号 id：undefined 表示还在解析，null 表示没有匹配账号 */
    const wechatAccountId = useWechatAccountByAppId(wechatAppId)
    const currentWechatAccountId = route.name === 'wechatAccount' ? route.accountId : null

    /**
     * 非作品、非公众号文档（笔记或未保存的 untitled 等索引外文档）回到概览首页：
     * 仪表盘只有概览、作品与公众号三类页面，停在作品详情看笔记等于没切换。
     * 无从判定（undefined，焦点不在编辑器）时保持当前页；归属未变化时不重复导航；
     * 公众号文档由下面的跟随逻辑处理，这里不参与，避免两个 effect 抢同一个导航。
     */
    useEffect(() => {
        const previous = lastScopeRef.current
        lastScopeRef.current = scope
        if (scope === undefined || scope === 'press' || scope === 'wechat' || scope === previous) {
            return
        }
        if (route.name !== 'home') {
            navigate(createHomeRoute())
        }
    }, [navigate, route.name, scope])

    /**
     * 公众号文档跟随：打开批次文档时跳到该账号的推送批次列表。
     * 关键约束：按文档路径去重（同一篇只跟随一次），用户手动返回列表页不会被弹回；
     * 账号还在解析时不动（避免先回首页再跳），找不到账号时回首页；已在目标账号页则不重复导航。
     */
    useEffect(() => {
        if (scope !== 'wechat' || activeDocumentPath === null || wechatAccountId === undefined) {
            return
        }
        if (followedWechatDocRef.current === activeDocumentPath) {
            return
        }
        if (wechatAccountId === null) {
            followedWechatDocRef.current = activeDocumentPath
            if (route.name !== 'home' && route.name !== 'wechat') {
                navigate(createHomeRoute())
            }
            return
        }
        followedWechatDocRef.current = activeDocumentPath
        if (currentWechatAccountId !== wechatAccountId) {
            navigate(createWechatAccountRoute(wechatAccountId))
        }
    }, [activeDocumentPath, currentWechatAccountId, navigate, route.name, scope, wechatAccountId])

    useEffect(() => {
        if (activeProjectDirPath === null || activeProjectDirPath === followedProjectRef.current) {
            return
        }
        followedProjectRef.current = activeProjectDirPath
        if (route.name === 'pressProject' && route.dirPath === activeProjectDirPath) {
            return
        }
        navigate(createPressProjectRoute(activeProjectDirPath))
    }, [activeProjectDirPath, navigate, route])

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
                return <DashboardPress onOpenProject={(dirPath) => navigate(createPressProjectRoute(dirPath))} />
            case 'wechat':
                return <DashboardWechat onOpenAccount={(accountId) => navigate(createWechatAccountRoute(accountId))} />
            case 'wechatAccount':
                // 账号切换即重挂载：批次列表按账号重新取数，不沿用上一个账号的快照
                return (
                    <DashboardWechatPost
                        key={route.accountId}
                        accountId={route.accountId}
                        onRemoved={() => navigate(createWechatRoute())}
                    />
                )
            default:
                return <Dashboard onNavigate={navigate} />
        }
    }

    return (
        <>
            {/* 页面骨架按 h-full 撑满，这里给出视口高度基准（与 WorkflowScreen 同形），避免页面高度塌陷 */}
            <div className="flex h-screen min-h-0 flex-col">{renderPage()}</div>
            <Toaster theme={theme} />
        </>
    )
}
