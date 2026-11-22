/**
 * 打开外部链接：统一走宿主 weibo/openPost，失败提示交 @shared/utils/error。
 * 复用约定：地址由调用方构造（如 utils/weiboLinks 的 buildProfileUrl），本 Hook 只负责打开；
 * 返回的回调零依赖，可直接进 useCallback 依赖或 props，不会引起重渲染。
 * 关键约束：webview 内不得直接跳转（会顶掉面板），一律交宿主打开；
 * 失败只提示、不改调用方状态，打开动作与内容区状态互不影响。
 */
import { useCallback } from 'react'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 打开地址的稳定回调：同一面板内多次使用不会因引用变化触发子组件更新 */
export function useWeiboOpenUrl(): (url: string) => void {
    return useCallback((url: string): void => {
        void request(WEIBO_METHODS.openPost, { url }).catch(toastError)
    }, [])
}
