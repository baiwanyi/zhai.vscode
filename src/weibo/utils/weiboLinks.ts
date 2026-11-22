/**
 * 微博链接：个人主页（uid / 昵称）与热搜搜索页的地址构造与主页链接识别。
 * 复用约定：只拼地址与识别地址、不发起请求，打开动作由 hooks/useWeiboOpenUrl 与 useWeiboSearchOpen 完成；
 * 正文纯文本里的 @账号、话题与链接切分在 @shared/utils/weiboText，本文件只保留站内地址。
 * 目标站都是 weibo.com 及其子域，宿主 weibo/openPost 的白名单直接放行。
 * 关键约束：uid、昵称与关键字都来自上游 JSON，可能含空格、中文与 # ? / 等字符，
 * 拼进路径或查询串前必须 encodeURIComponent；主页地址 uid 版优先（改名后仍可定位），
 * 昵称版只在缺 uid 时兜底；识别主页链接时只认 weibo.com 与 https，其余一律返回 null；
 * 主页短形式 `/{uid}` 与 `/u/{uid}` 同义，但只认单段纯数字，两段以上的详情页不当作主页。
 */

/** 个人主页基址：末段为账号 uid */
const PROFILE_URL_BASE = 'https://weibo.com/u'

/** 昵称主页基址：末段为昵称，微博按昵称跳转到对应用户 */
const PROFILE_NAME_URL_BASE = 'https://weibo.com/n'

/** 搜索页基址：不含查询串，参数由 buildHotSearchUrl 拼接 */
const HOT_SEARCH_URL_BASE = 'https://s.weibo.com/weibo'

/** 主页链接的站点范围：与宿主外链白名单的 weibo.com 分支一致 */
const PROFILE_LINK_HOST = 'weibo.com'

/** 昵称路径：`/n/{昵称}` 只按昵称定位，昵称本身允许中文与空格 %20 */
const PROFILE_NAME_PATH_PATTERN = /^\/n\/([^/]{1,128})\/?$/u

/** uid 路径：`/u/{uid}` 与 `/profile/{uid}` 同义，非数字末段按微博号（昵称）处理 */
const PROFILE_UID_PATH_PATTERN = /^\/(?:u|profile)\/([^/]{1,64})\/?$/u

/** 主页短形式：`/{uid}` 只认单段纯数字，详情页是两段路径，不会被这里命中 */
const PROFILE_ROOT_PATH_PATTERN = /^\/([0-9]{4,25})\/?$/u

/** 数字 uid 形态：纯数字且长度合理，避免把微博号误判成 uid */
const NUMERIC_UID_PATTERN = /^[0-9]{4,25}$/u

/** 昵称长度上限：与协议层收窄口径一致 */
const PROFILE_NAME_MAX_LENGTH = 64

/**
 * 主页定位目标：uid 直接可用，昵称需由宿主经 profile/info 换算成 uid。
 * 关键约束：value 已在解析阶段解码并校验，调用方可直接放进协议载荷。
 */
export interface WeiboUserTarget {
    kind: 'uid' | 'name'
    value: string
}

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

/** 是否属于微博主站：精确匹配或点分后缀，避免 weibo.com.evil.com 绕过 */
function isProfileLinkHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return host === PROFILE_LINK_HOST || host.endsWith(`.${PROFILE_LINK_HOST}`)
}

/** 解码路径段：非法转义、空串、超长与含控制字符一律视为不可用 */
function decodePathSegment(raw: string): string | null {
    let decoded: string
    try {
        decoded = decodeURIComponent(raw).trim()
    } catch {
        return null
    }
    if (decoded.length === 0 || decoded.length > PROFILE_NAME_MAX_LENGTH) {
        return null
    }
    return /[\p{Cc}]/u.test(decoded) ? null : decoded
}

/**
 * 识别个人主页链接：命中 `/u/{uid}`、`/profile/{uid}`、`/{uid}` 与 `/n/{昵称}` 时返回定位目标。
 * 关键约束：只接受 https 且主机在 weibo.com 下的地址；数字末段判为 uid，其余按昵称交给宿主换算，
 * 非主页链接返回 null，由调用方继续走浏览器打开。
 */
export function readProfileTarget(url: string): WeiboUserTarget | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== 'https:' || !isProfileLinkHost(parsed.hostname)) {
        return null
    }
    const nameMatched = PROFILE_NAME_PATH_PATTERN.exec(parsed.pathname)
    const rawName = nameMatched?.[1]
    if (rawName !== undefined) {
        const name = decodePathSegment(rawName)
        return name === null ? null : { kind: 'name', value: name }
    }
    const uidMatched = PROFILE_UID_PATH_PATTERN.exec(parsed.pathname)
    const rawSegment = uidMatched?.[1]
    if (rawSegment !== undefined) {
        const segment = decodePathSegment(rawSegment)
        if (segment === null) {
            return null
        }
        return NUMERIC_UID_PATTERN.test(segment) ? { kind: 'uid', value: segment } : { kind: 'name', value: segment }
    }
    // 短形式 `/{uid}`：只认单段纯数字，详情页（两段路径）与话题页不会被命中
    const rootMatched = PROFILE_ROOT_PATH_PATTERN.exec(parsed.pathname)
    const rawRootUid = rootMatched?.[1]
    return rawRootUid === undefined ? null : { kind: 'uid', value: rawRootUid }
}
