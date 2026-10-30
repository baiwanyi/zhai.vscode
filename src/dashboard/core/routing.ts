/**
 * 仪表盘页内路由：Webview 没有地址栏，以 hash 承载唯一可寻址的页面路径，前进后退与手动导航同源。
 * 供 dashboardScreen 与各入口共用，纯函数便于单测；新增页面只需扩充解析分支，不引入前端路由库。
 * 关键约束：未登记路径与非法编码一律回落首页，避免面板重载后停在空白页；
 * 作品详情路径的作品名以 encodeURIComponent 承载，解码后仍须是单段且不含上跳片段。
 */

/** 作品模块的一级目录名：详情路由据此拼装与还原 dirPath */
export const PRESS_MODULE_PATH = 'press'

/** 笔记模块的一级目录名：与 shared/types/workflow 的 NOTES_MODULE_KEY 同值 */
const NOTES_MODULE_PATH = 'notes'

/** 公众号模块的一级目录名：模块尚未接入，先按约定占位，接入后与宿主目录名对齐 */
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

/** 页内路由：首页、作品列表、作品详情（携带相对存储根的 dirPath） */
export type DashboardRoute = { name: 'home' } | { name: 'press' } | { name: 'pressProject'; dirPath: string }

/** 作品详情路径的匹配式：只接受单段作品名，多余层级一律视为未登记 */
const PROJECT_PATH_PATTERN = /^\/press\/([^/]+)$/

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

/** 上一级路由：作品详情回作品列表，作品列表与概览首页回首页（首页没有更上一层） */
export function createParentRoute(route: DashboardRoute): DashboardRoute {
    return route.name === 'pressProject' ? createPressRoute() : createHomeRoute()
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

/** 解析地址栏 hash：'#/press' → 作品列表，'#/press/{作品名}' → 作品详情，其余回落首页 */
export function parseRoute(hash: string): DashboardRoute {
    const path = hash.startsWith('#') ? hash.slice(1) : hash
    if (path === '/') {
        return createHomeRoute()
    }
    if (path === '/press') {
        return createPressRoute()
    }
    const matched = PROJECT_PATH_PATTERN.exec(path)
    if (matched?.[1] !== undefined) {
        const name = decodeProjectName(matched[1])
        if (name !== null) {
            return createPressProjectRoute(`${PRESS_MODULE_PATH}/${name}`)
        }
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
        default:
            return '#/'
    }
}
