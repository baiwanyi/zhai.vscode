/**
 * 仪表盘页内路由：Webview 没有地址栏，以 hash 承载唯一可寻址的页面路径，前进后退与手动导航同源。
 * 供 dashboardScreen 与各入口共用，纯函数便于单测；新增页面只需扩充解析分支，不引入前端路由库。
 * 关键约束：未登记路径与非法编码一律回落首页，避免面板重载后停在空白页；
 * 作品详情路径的作品名以 encodeURIComponent 承载，解码后仍须是单段且不含上跳片段；
 * 公众号账号 id 走 shared/types/wechat 的白名单收窄，与宿主落库的 id 形态同源，避免两处口径分叉。
 */
import { isWechatAccountId } from '@shared/types/wechat'

/** 作品模块的一级目录名：详情路由据此拼装与还原 dirPath */
export const PRESS_MODULE_PATH = 'press'

/** 笔记模块的一级目录名：与 shared/types/workflow 的 NOTES_MODULE_KEY 同值 */
const NOTES_MODULE_PATH = 'notes'

/** 公众号模块的一级目录名：与宿主 wechat.db 及工作流模块键保持一致 */
const WECHAT_MODULE_PATH = 'wechat'

/** 内容归属：null 表示打开了文档但不属于任何已接入模块 */
export type DashboardContentScope = 'press' | 'note' | 'wechat' | null

/**
 * 判定当前文档的内容归属：undefined 表示无从判定（焦点不在文本编辑器），此时保持当前页；
 * null 表示有编辑器但文档不属于任何已接入模块，仪表盘应回概览首页。
 * 关键约束：作品以宿主下发的 projectDir 为准，其余按相对路径的一级目录名判定；
 * 有编辑器却拿不到索引内路径（未保存的 untitled、索引外文件）即视为无归属——
 * 若沿用上一次归属，面板会停在上一篇文档的页面上，切文档等于没切；
 * 焦点不在编辑器（打开设置、切到其它视图）一律不做判定，避免面板被无谓弹回首页。
 */
export function readContentScope(
    activePath: string | null,
    projectDir: string | null,
    hasEditor: boolean,
): DashboardContentScope | undefined {
    if (projectDir !== null) {
        return 'press'
    }
    if (!hasEditor) {
        return undefined
    }
    if (activePath === null) {
        return null
    }
    const moduleKey = activePath.split('/')[0]
    if (moduleKey === PRESS_MODULE_PATH) {
        return 'press'
    }
    if (moduleKey === NOTES_MODULE_PATH) {
        return 'note'
    }
    if (moduleKey === WECHAT_MODULE_PATH) {
        return 'wechat'
    }
    return null
}

/**
 * 页内路由：概览首页、作品列表、作品详情（携带相对存储根的 dirPath）、
 * 公众号账号列表与某账号下的推送批次列表。
 */
export type DashboardRoute =
    | { name: 'home' }
    | { name: 'press' }
    | { name: 'pressProject'; dirPath: string }
    | { name: 'wechat' }
    | { name: 'wechatAccount'; accountId: string }

/** 作品详情路径的匹配式：只接受单段作品名，多余层级一律视为未登记 */
const PROJECT_PATH_PATTERN = /^\/press\/([^/]+)$/

/** 公众号账号路径的匹配式：账号 id 由宿主生成，不含路径分隔符 */
const WECHAT_ACCOUNT_PATH_PATTERN = /^\/wechat\/([^/]+)$/

/** 概览首页路由：解析兜底与导航共用 */
export function createHomeRoute(): DashboardRoute {
    return { name: 'home' }
}

/** 作品列表页路由 */
export function createPressRoute(): DashboardRoute {
    return { name: 'press' }
}

/** 作品详情页路由 */
export function createPressProjectRoute(dirPath: string): DashboardRoute {
    return { name: 'pressProject', dirPath }
}

/** 公众号账号列表页路由 */
export function createWechatRoute(): DashboardRoute {
    return { name: 'wechat' }
}

/** 公众号推送批次列表页路由 */
export function createWechatAccountRoute(accountId: string): DashboardRoute {
    return { name: 'wechatAccount', accountId }
}

/** 上一级路由：详情页回各自列表页，列表页与概览首页回首页（首页没有更上一层） */
export function createParentRoute(route: DashboardRoute): DashboardRoute {
    switch (route.name) {
        case 'pressProject':
            return createPressRoute()
        case 'wechatAccount':
            return createWechatRoute()
        default:
            return createHomeRoute()
    }
}

/**
 * 解码作品名：非法编码或越界片段返回 null，由调用方回落首页。
 * 安全约束：解码可能产出 `/`、`\`、`.`、`..`，这些片段会把路径带出作品目录，一律拒绝。
 */
function decodeProjectName(encoded: string): string | null {
    let name: string
    try {
        name = decodeURIComponent(encoded)
    } catch {
        return null
    }
    const isUnsafe = name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
    return isUnsafe ? null : name
}

/** 解析地址栏 hash：#/press → 作品列表，#/wechat → 公众号列表，其余回落首页 */
export function parseRoute(hash: string): DashboardRoute {
    const path = hash.startsWith('#') ? hash.slice(1) : hash
    if (path === '/') {
        return createHomeRoute()
    }
    if (path === '/press') {
        return createPressRoute()
    }
    if (path === '/wechat') {
        return createWechatRoute()
    }
    const matchedProject = PROJECT_PATH_PATTERN.exec(path)
    if (matchedProject?.[1] !== undefined) {
        const name = decodeProjectName(matchedProject[1])
        if (name !== null) {
            return createPressProjectRoute(`${PRESS_MODULE_PATH}/${name}`)
        }
        return createHomeRoute()
    }
    const matchedAccount = WECHAT_ACCOUNT_PATH_PATTERN.exec(path)
    if (matchedAccount?.[1] !== undefined && isWechatAccountId(matchedAccount[1])) {
        return createWechatAccountRoute(matchedAccount[1])
    }
    return createHomeRoute()
}

/** 生成页面路径对应的 hash，供导航写入地址栏 */
export function toHash(route: DashboardRoute): string {
    switch (route.name) {
        case 'press':
            return '#/press'
        case 'pressProject':
            return `#/press/${encodeURIComponent(route.dirPath.replace(/^press\//, ''))}`
        case 'wechat':
            return '#/wechat'
        case 'wechatAccount':
            return `#/wechat/${route.accountId}`
        default:
            return '#/'
    }
}
