/**
 * 打开微博链接：个人主页走页内，其余统一走宿主 weibo/openPost，失败提示交 @shared/utils/error。
 * 复用约定：地址由调用方构造（如 utils/weiboLinks 的 buildProfileUrl），本 Hook 只负责分发；
 * 主页识别交给 utils/weiboLinks.readProfileTarget，页内导航交给 context/WeiboUserPageContext。
 * 关键约束：webview 内不得直接跳转（会顶掉面板），一律交宿主打开；
 * 只有链接形态确实是 /u/ 或 /n/ 主页时才改走页内，话题、短链与详情页不受影响；
 * 未挂 Provider（单测、预览）时退回浏览器打开，不因缺少上下文而丢动作。
 */
import { useCallback } from 'react'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { useWeiboUserPageNav } from '../context/weiboUserPageContext'
import { readProfileTarget } from '../utils/weiboLinks'

/** 打开地址的稳定回调：同一面板内多次使用不会因引用变化触发子组件更新 */
export function useWeiboOpenUrl(): (url: string) => void {
    const userPage = useWeiboUserPageNav()
    const openUser = userPage?.openUser

    return useCallback(
        (url: string): void => {
            const target = openUser === undefined ? null : readProfileTarget(url)
            if (target !== null && openUser !== undefined) {
                openUser(target)
                return
            }
            void request(WEIBO_METHODS.openPost, { url }).catch(toastError)
        },
        [openUser],
    )
}
