/**
 * 仪表盘页内路由：Webview 没有地址栏，以 hash 承载唯一可寻址的页面路径，前进后退与手动导航同源。
 * 供 dashboardScreen 与各入口共用，纯函数便于单测；新增页面只需扩充解析表，不引入前端路由库。
 * 关键约束：未登记的路径一律回落首页，避免面板重载后停在空白页；hash 形态固定为 #/press。
 */

/** 仪表盘可展示的页面路径：'/' 为概览首页，'/press' 为写作管理（作品）页 */
export type DashboardRoute = '/' | '/press'

/** 已登记的页面路径，解析时据此判定是否可识别 */
const KNOWN_ROUTES: readonly DashboardRoute[] = ['/', '/press']

/** 默认落点：无法识别时回到概览首页 */
export const HOME_ROUTE: DashboardRoute = '/'

/** 解析地址栏 hash：'#/press' → '/press'，其余（含空值与未知路径）→ '/' */
export function parseRoute(hash: string): DashboardRoute {
    const normalized = hash.startsWith('#') ? hash.slice(1) : hash
    return KNOWN_ROUTES.find((route) => route === normalized) ?? HOME_ROUTE
}

/** 生成页面路径对应的 hash，供导航写入地址栏 */
export function toHash(route: DashboardRoute): string {
    return `#${route}`
}
