/**
 * 微博链接：个人主页（uid / 昵称）与热搜搜索页的地址构造，以及标题链接的点击语义。
 * 复用约定：只拼地址、不发起请求，打开动作由 hooks/useWeiboOpenUrl 与 useWeiboSearchOpen 完成；
 * 正文纯文本里的 @账号、话题与链接切分在 @shared/utils/weiboText，本文件只保留站内地址；
 * 目标站都是 weibo.com 及其子域，宿主 weibo/openPost 的白名单直接放行。
 * 关键约束：uid、昵称与关键字都来自上游 JSON，可能含空格、中文与 # ? / 等字符，
 * 拼进路径或查询串前必须 encodeURIComponent；主页地址 uid 版优先（改名后仍可定位），
 * 昵称版只在缺 uid 时兜底。
 */
import type { MouseEvent } from 'react'

/** 个人主页基址：末段为账号 uid */
const PROFILE_URL_BASE = 'https://weibo.com/u'

/** 昵称主页基址：末段为昵称，微博按昵称跳转到对应用户 */
const PROFILE_NAME_URL_BASE = 'https://weibo.com/n'

/** 搜索页基址：不含查询串，参数由 buildHotSearchUrl 拼接 */
const HOT_SEARCH_URL_BASE = 'https://s.weibo.com/weibo'

/** 个人主页地址：uid 转义后拼到固定基址上 */
export function buildProfileUrl(uid: string): string {
    return `${PROFILE_URL_BASE}/${encodeURIComponent(uid)}`
}

/** 按昵称的主页地址：缺 uid 时用它兜底，昵称整段转义避免被当成路径或查询串 */
export function buildProfileNameUrl(name: string): string {
    return `${PROFILE_NAME_URL_BASE}/${encodeURIComponent(name)}`
}

/** 热搜搜索页地址：关键字按 URL 规则转码 */
export function buildHotSearchUrl(title: string): string {
    return `${HOT_SEARCH_URL_BASE}?q=${encodeURIComponent(title)}`
}

/** 标题链接只承担语义与键盘可达：阻止 webview 自身导航，点击冒泡回整行的打开动作 */
export function preventLinkNavigation(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()
}
