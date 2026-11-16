/**
 * 内容跟随：按当前文档归属把仪表盘导航到对应页面（概览首页 / 作品详情 / 公众号账号页）。
 * 复用 ../core/routing 的归属判定、回落判定与路由工厂，不感知页面组件，也不写 hash。
 * 关键约束：归属回落、作品跟随、公众号跟随各占一个 effect，靠 scope 三态天然互斥，同一归属只被一条规则处理；
 * 跟随记录在「离开文档」时复位，重新进入同一作品/文档会再跟随一次；
 * 用户点返回或停留在详情页时记录命中即短路，不会被弹回；公众号账号解析中不动，避免先回首页再跳。
 */
import { useEffect, useRef } from 'react'
import type { DashboardContentScope, DashboardRoute } from '../core/routing'
import {
    createHomeRoute,
    createPressProjectRoute,
    createWechatAccountRoute,
    shouldFallbackToHome,
} from '../core/routing'

export interface ContentFollowOptions {
    /** 当前内容归属：undefined 表示焦点不在文本编辑器、无从判定 */
    scope: DashboardContentScope | undefined
    /** 当前活动文档的索引内路径：null 表示无文档或落在索引外 */
    activeDocumentPath: string | null
    /** 当前活动文档所属的作品目录：null 表示不在作品文档内 */
    projectDirPath: string | null
    /** 当前文档对应的公众号账号：undefined 表示还在解析，null 表示没有匹配账号 */
    wechatAccountId: string | null | undefined
    route: DashboardRoute
    navigate: (route: DashboardRoute) => void
}

export function useContentFollow(options: ContentFollowOptions): void {
    const { activeDocumentPath, navigate, projectDirPath, route, scope, wechatAccountId } = options
    /** 已跟随过的公众号文档：同一次停留只跳一次，离开批次文档时复位 */
    const followedWechatDocRef = useRef<string | null>(null)
    /** 上次内容归属：只在归属真的换了时才决定是否回首页，用户手动进出其它页不会被弹回 */
    const lastScopeRef = useRef<DashboardContentScope | undefined>(undefined)
    /** 已跟随过的作品目录：同一次停留只跳一次，离开作品文档时复位 */
    const followedProjectRef = useRef<string | null>(null)
    const currentWechatAccountId = route.name === 'wechatAccount' ? route.accountId : null

    /**
     * 归属回落：笔记或未保存的 untitled 等索引外文档回概览首页——
     * 仪表盘只有概览、作品与公众号三类页面，停在作品详情看笔记等于没切换。
     */
    useEffect(() => {
        const previous = lastScopeRef.current
        lastScopeRef.current = scope
        if (shouldFallbackToHome(scope, previous, route.name)) {
            navigate(createHomeRoute())
        }
    }, [navigate, route.name, scope])

    /**
     * 公众号文档跟随：打开批次文档时跳到该账号的推送批次列表。
     * 离开批次文档即复位跟随记录，重新打开同一篇仍会跟随一次；
     * 找不到账号的文档回概览首页；已在目标账号页则不重复导航。
     */
    useEffect(() => {
        if (scope !== 'wechat' || activeDocumentPath === null) {
            followedWechatDocRef.current = null
            return
        }
        if (wechatAccountId === undefined) {
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

    /**
     * 作品跟随：按活动文档进入该作品详情，之后编辑区切换标签由 press 通道同步。
     * 空值与空串都视为「离开作品文档」：复位跟随记录，下次重新进入同一作品仍会跟随一次；
     * 已在同一作品详情时不重复导航，避免无谓重挂载。
     */
    useEffect(() => {
        if (projectDirPath === null || projectDirPath.length === 0) {
            followedProjectRef.current = null
            return
        }
        if (projectDirPath === followedProjectRef.current) {
            return
        }
        followedProjectRef.current = projectDirPath
        if (route.name === 'pressProject' && route.dirPath === projectDirPath) {
            return
        }
        navigate(createPressProjectRoute(projectDirPath))
    }, [navigate, projectDirPath, route])
}
