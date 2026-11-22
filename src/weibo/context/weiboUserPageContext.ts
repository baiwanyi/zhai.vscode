/**
 * 个人主页的页内导航上下文：只放 context、类型与读取 Hook，Provider 在 WeiboUserPageProvider。
 * 复用约定：目标由 utils/weiboLinks 的 readProfileTarget 解析；
 * hooks/useWeiboOpenUrl 命中主页链接时改走这里，页面层只负责把目标落成状态。
 * 与 Provider 拆成两个文件，使各自只导出一种成员（组件 / 非组件），避免 fast refresh 失效。
 * 关键约束：Context 缺省为 null（单测与预览不包 Provider 也能渲染），调用方据此退回浏览器打开。
 */
import { createContext, use } from 'react'
import type { WeiboUserTarget } from '../utils/weiboLinks'

export interface WeiboUserPageNav {
    /** 打开某个用户的个人主页：目标已由 readProfileTarget 收窄 */
    openUser: (target: WeiboUserTarget) => void
}

/** 缺省为 null：未挂 Provider 时不接管任何链接 */
export const WeiboUserPageContext = createContext<WeiboUserPageNav | null>(null)

/** 取主页导航：未包 Provider 时返回 null，调用方退回浏览器打开 */
export function useWeiboUserPageNav(): WeiboUserPageNav | null {
    return use(WeiboUserPageContext)
}
