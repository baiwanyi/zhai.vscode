/**
 * 微博页导航：当前视图、页内个人主页目标，以及菜单与主页入口共用的切换动作。
 * 复用约定：视图标识来自 layout/weiboNavGroups，主页目标类型来自 utils/weiboLinks；
 * 页面只消费状态与动作，不再自行维护「切页要不要清主页」这类规则。
 * 关键约束：切页必须清空主页目标——否则停在别人主页上继续点菜单会看到错的内容流；
 * 主页 uid 未识别时不拼空地址，只给一条「保存 Cookie 后会自动读取」的提示；
 * 返回的动作都 useCallback 化，可直接进菜单等下游 Hook 的依赖数组。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { WeiboView } from '../layout/weiboNavGroups'
import type { WeiboUserTarget } from '../utils/weiboLinks'
import { HOME_RECOMMEND_VIEW } from '../layout/weiboNavGroups'

export interface WeiboPageNavOptions {
    /** 当前登录账号 uid：为 null 时主页入口只提示，不打开空地址 */
    profileUid: string | null
}

export interface WeiboPageNavController {
    /** 当前视图：首页 / 时间线 / 我的赞 / 热搜 / 热门频道 / 自建分组 */
    view: WeiboView
    /** 页内个人主页目标：非空时内容区整块换成该用户的主页 */
    userTarget: WeiboUserTarget | null
    /** 切页：同时清空主页目标 */
    selectView: (next: WeiboView) => void
    /** 回到首页推荐：删凭证后用它，比 selectView(HOME_RECOMMEND_VIEW) 更能表达意图 */
    selectHome: () => void
    /** 打开「我的赞」：入口在账号菜单，切换后由 likesFeed 负责首屏取数 */
    openLikes: () => void
    /** 页内打开某个用户的主页 */
    openUser: (target: WeiboUserTarget) => void
    /** 关闭主页：只清空目标，原视图与已加载内容原地保留 */
    closeUser: () => void
    /** 打开当前账号自己的主页：uid 未识别时只提示，不跳空地址 */
    openProfile: () => void
}

/** 导航控制器：视图与主页目标都收在这里，页面只做组装 */
export function useWeiboPageNav({ profileUid }: WeiboPageNavOptions): WeiboPageNavController {
    const [view, setView] = useState<WeiboView>(HOME_RECOMMEND_VIEW)
    const [userTarget, setUserTarget] = useState<WeiboUserTarget | null>(null)

    /** 切页统一清空主页目标：顶部菜单与热门频道都走这里 */
    const selectView = useCallback((next: WeiboView): void => {
        setUserTarget(null)
        setView(next)
    }, [])

    const selectHome = useCallback((): void => {
        selectView(HOME_RECOMMEND_VIEW)
    }, [selectView])

    const openLikes = useCallback((): void => {
        selectView('mine.likes')
    }, [selectView])

    const openUser = useCallback((target: WeiboUserTarget): void => {
        setUserTarget(target)
    }, [])

    const closeUser = useCallback((): void => {
        setUserTarget(null)
    }, [])

    const openProfile = useCallback((): void => {
        if (profileUid === null) {
            toast.info('还没有识别到账号：保存 Cookie 后会自动读取')
            return
        }
        openUser({ kind: 'uid', value: profileUid })
    }, [openUser, profileUid])

    return { view, userTarget, selectView, selectHome, openLikes, openUser, closeUser, openProfile }
}
