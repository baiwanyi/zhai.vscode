/**
 * 热搜外链：把榜单标题转成搜索页地址，并给标题链接一个统一的「只做语义、不导航」处理器。
 * 复用约定：纯函数、无 React 状态依赖，侧栏行与专页行共用同一条地址规则；
 * 目标站 s.weibo.com 属 weibo.com 子域，宿主 weibo/openPost 的白名单直接放行。
 * 关键约束：标题一律经 encodeURIComponent，话题词里的 # 与空格不会被当成片段或参数；
 * 本文件只拼地址与阻止 webview 自身导航，真正的打开动作仍由调用方的 weibo/openPost 完成。
 */
import type { MouseEvent } from 'react'

/** 搜索页基址：不含查询串，参数由 buildHotSearchUrl 拼接 */
const HOT_SEARCH_URL_BASE = 'https://s.weibo.com/weibo'

/** 热搜搜索页地址：关键字按 URL 规则转码 */
export function buildHotSearchUrl(title: string): string {
    return `${HOT_SEARCH_URL_BASE}?q=${encodeURIComponent(title)}`
}

/** 标题链接只承担语义与键盘可达：阻止 webview 自身导航，点击冒泡回整行的打开动作 */
export function preventLinkNavigation(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()
}
