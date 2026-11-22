/**
 * 微博媒体地址归一化：图片、视频与中等尺寸档位的白名单收窄，供取数、代理、缓存与笔记共用。
 * 复用约定：端点常量统一取 weiboEndpoints，调用方不再自拼图床或 CDN 地址；
 * 只做地址层面的纯函数变换，不发起请求、不读写缓存，因此可被任意层依赖而不形成倒挂。
 * 关键约束：图片与视频都只接受 https 且主机在白名单内，越界一律返回 null；
 * 视频的 http 直链统一升级为 https；需要登录态的图片下载端点改写为图床直链。
 */
import { WEIBO_IMAGE_PID_PATTERN } from '@shared/types/weibo'
import { WEIBO_AJAX_PATHS, WEIBO_IMAGE_ORIGIN } from '../endpoints'

/**
 * 图片主机白名单：新浪图床与表情 CDN 承载绝大多数图片；
 * 微博主站与移动站的图片端点也会直接出现在头像和正文里，一并放行。
 */
const WEIBO_IMAGE_HOSTS = ['sinaimg.cn', 'sinajs.cn', 'weibo.com', 'weibo.cn'] as const

/** 主机是否在白名单后缀下：要求精确相等或点分后缀，避免 sub.host.evil.com 绕过 */
function isWeiboImageHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return WEIBO_IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** 用图片 pid 拼图床直链：微博自家的下载端点要登录 Cookie，Webview 直连会 401 */
export function buildSinaImageUrl(pid: string): string | null {
    return WEIBO_IMAGE_PID_PATTERN.test(pid) ? `${WEIBO_IMAGE_ORIGIN}/large/${pid}.jpg` : null
}

/**
 * 归一化图片地址：兼容协议相对写法，并把需要登录态的微博下载端点改写成图床直链。
 * 只接受 https 且主机在白名单内，其余一律返回 null——前端不接触任意外链。
 */
export function normalizeWeiboImageUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > 1024) {
        return null
    }
    const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
    let parsed: URL
    try {
        parsed = new URL(withProtocol)
    } catch {
        return null
    }
    if (parsed.protocol !== 'https:' || !isWeiboImageHost(parsed.hostname)) {
        return null
    }
    // ajax/common/download?pid=xxx 需要登录 Cookie：改写成同一对象的图床直链
    if (parsed.pathname.endsWith(WEIBO_AJAX_PATHS.imageDownload)) {
        return buildSinaImageUrl(parsed.searchParams.get('pid') ?? '')
    }
    return parsed.toString()
}

/** 是否为可用图片地址：归一化成功即可用 */
export function isWeiboImageUrl(value: unknown): value is string {
    return normalizeWeiboImageUrl(value) !== null
}

/** 视频主机白名单：整段 mp4 落在 f.video.weibocdn.com，部分旧资源在 video.weibo.com */
const WEIBO_VIDEO_HOSTS = ['weibocdn.com', 'weibo.com', 'weibo.cn'] as const

/**
 * 归一化视频地址：主机必须落在视频 CDN 白名单内。
 * 关键约束：网页端回包的整段 mp4 是 **http** 直链（实测 `http://f.video.weibocdn.com/...`），
 * 这里统一升级成 https 再交给宿主取回——否则 Webview 侧会被混合内容拦掉，宿主端也更安全；
 * 地址带 Expires / ssig 签名，只在本次会话内有效，既不能分享也不宜长期缓存，
 * 宿主按 URL 哈希落盘，签名变化会产生新缓存，由缓存清理兜底。
 */
export function normalizeWeiboVideoUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > 1024) {
        return null
    }
    let parsed: URL
    try {
        parsed = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed)
    } catch {
        return null
    }
    if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:'
    }
    if (parsed.protocol !== 'https:') {
        return null
    }
    const host = parsed.hostname.toLowerCase()
    const isAllowed = WEIBO_VIDEO_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    return isAllowed ? parsed.toString() : null
}

/** 图床的尺寸目录：这些目录可换成 bmiddle；thumbnail 已足够小，不参与替换 */
const IMAGE_SIZE_DIRS = new Set(['large', 'original', 'orj1080', 'orj960', 'mw2000', 'mw1024', 'mw690', 'thumb300'])

/**
 * 取中等尺寸地址：把 `/large/`、`/orj960/`、`/mw2000/` 等尺寸目录换成 `/bmiddle/`（长边 360）。
 * 展示图档位缺失与宿主「超大图降级」都靠它兜底。
 * 头像裁切路径与表情 CDN 没有尺寸目录，原样返回；无法解析的地址也原样返回。
 */
export function buildMiddleImageUrl(imageUrl: string): string {
    try {
        const url = new URL(imageUrl)
        const segments = url.pathname.split('/')
        const sizeDir = segments[1] ?? ''
        if (!IMAGE_SIZE_DIRS.has(sizeDir)) {
            return imageUrl
        }
        segments[1] = 'bmiddle'
        url.pathname = segments.join('/')
        return url.toString()
    } catch {
        return imageUrl
    }
}
