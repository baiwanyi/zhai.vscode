/**
 * 仪表盘路由外壳：按页内路由渲染概览首页、作品列表或作品详情，是仪表盘内唯一的页面切换点。
 * 路由与导航由 core/routeContext 的 Provider 统一提供，页面、页头返回动作与底部入口共享同一份；
 * 页面组件只接收导航回调，不自行读写 hash；路由分派收在 layout/DashboardRouteSwitch，跟随规则收在 hooks/useContentFollow。
 * 关键约束：详情页以 dirPath 作为 key，切换作品即重挂载，分批渲染计数与滚动位置随之重置；
 * 切换页面时旧页面卸载，重新进入会重新拉取数据，避免跨页面共享过期快照；
 * 作品跟随：打开面板时按活动文档进入该作品详情，之后编辑区切换标签由 press 通道同步；
 * 离开作品文档即复位跟随记录，重新进入同一作品会再跟随一次；用户点返回或停留在详情页时不会被弹回，
 * 已在同一作品详情时不重复导航，避免无谓重挂载；
 * 公众号跟随：文档落在 wechat/{appid}/post/ 下时按 AppID 找到本地账号，跳到该账号的推送批次列表；
 * 同样在离开批次文档时复位，重新打开同一篇会再跟随一次，用户手动返回列表页后不会被弹回，找不到账号的文档回概览首页；
 * 归属回落：笔记与未保存的 untitled 等索引外文档一律回概览首页；
 * 归属未变化、或焦点不在文本编辑器而没有可判定文档时保持当前页。
 * 归属就绪门：作品归属、活跃笔记与公众号账号任一未解析完时先渲染骨架，不按初始值渲染概览 ——
 * 否则作品/批次文档下打开仪表盘会先闪一页概览，并白拉一次概览数据；失败也置就绪，避免骨架卡死。
 * 全局提示：sonner 的 Toaster 只在本层挂载一次，页面内的操作结果统一用 toast 上报，页面不再自挂；
 * 宿主侧命令结果统一在 Workflow 面板呈现（见 AiChatViewProvider），本层不订阅 toast 广播，避免同一提示弹两次。
 * 活跃笔记：ActiveNoteProvider 只在本层挂一次，路由归属判定与概览页的列表选中态共享同一份，
 * 页面点击回填的选中项因此能立刻参与归属判定，不必等宿主广播回传。
 */
import { Empty } from '@webview/blocks/Empty'
import { AppToaster } from '@webview/components/AppToaster'
import { DashboardRouteProvider } from './core/DashboardRouteProvider'
import { useDashboardRoute } from './core/routeContext'
import { readDashboardScope, readWechatAppId } from './core/routing'
import { ActiveNoteProvider } from './hooks/ActiveNoteProvider'
import { useActiveNote } from './hooks/useActiveNote'
import { useActivePressProject } from './hooks/useActivePressProject'
import { useContentFollow } from './hooks/useContentFollow'
import { DashboardRouteSwitch } from './layout/DashboardRouteSwitch'
import { useWechatAccountByAppId } from './wechat/hooks/useWechatAccountByAppId'
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
    const { projectDirPath: activeProjectDirPath, isReady: isPressReady } = useActivePressProject()
    const { activeId: activeDocumentPath, hasEditor, isReady: isNoteReady } = useActiveNote()

    const scope = readDashboardScope(activeDocumentPath, activeProjectDirPath, hasEditor)
    /** 当前文档所属的公众号 AppID：只有 wechat/{appid}/post/ 下的文档能解析出来 */
    const wechatAppId = readWechatAppId(activeDocumentPath)
    /** 对应账号 id：undefined 表示还在解析，null 表示没有匹配账号 */
    const wechatAccountId = useWechatAccountByAppId(wechatAppId)
    /**
     * 归属判定是否已就绪：作品归属、活跃笔记与公众号账号三者都到齐才渲染页面。
     * 否则作品/批次文档会被初始值先判成「无归属」而渲染概览，快照到达后再跳，闪一下并白拉一次概览数据。
     */
    const isRoutingReady = isPressReady && isNoteReady && !(scope === 'wechat' && wechatAccountId === undefined)

    useContentFollow({
        scope,
        activeDocumentPath,
        projectDirPath: activeProjectDirPath,
        wechatAccountId,
        route,
        navigate,
    })

    return (
        <>
            {/* 页面骨架按 h-full 撑满，这里给出视口高度基准（与 WorkflowScreen 同形），避免页面高度塌陷 */}
            <div className="flex h-screen min-h-0 flex-col">
                {isRoutingReady ? (
                    <DashboardRouteSwitch route={route} onNavigate={navigate} />
                ) : (
                    <Empty className="h-full" title="正在读取仪表盘..." isLoading />
                )}
            </div>
            <AppToaster />
        </>
    )
}
