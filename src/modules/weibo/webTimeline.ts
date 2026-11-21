/**
 * 关注时间线取数与归一化：把网页版 ajax 的 snake_case 原始结构收敛成 WeiboTimelinePost。
 * 复用约定：单页请求交给 webClient，游标只信任上游返回的 since_id / max_id；
 * 正文清洗、实体解码与正文链接（@账号 / 话题 / 超话 / 短链）都在这里一次性完成，
 * 前端按纯文本与分段渲染，不再二次解析 HTML。
 * 关键约束：max_id 是不规律长整型游标，不能自增构造；增量模式（sinceId 非 0）只取一页，
 * 否则会把历史内容一并拉上来；广告位与缺少 id 的条目直接丢弃，不进入去重计数；
 * 链接只认微博域名白名单，越界地址降级为纯文本，避免把任意地址带进 Webview。
 */
import type {
    WeiboTimelineImageSize,
    WeiboTimelineLinkKind,
    WeiboTimelineMedia,
    WeiboTimelineMediaItem,
    WeiboTimelineMetrics,
    WeiboTimelinePost,
    WeiboTimelineRequest,
    WeiboTimelineResult,
    WeiboTimelineVideoResolution,
    WeiboTimelineRetweet,
    WeiboTimelineSegment,
} from '@shared/types/weibo'
import { WEIBO_IMAGE_PID_PATTERN, WEIBO_TIMELINE_MAX_PAGES } from '@shared/types/weibo'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import { requestTimelinePage } from './webClient'
import { WEIBO_AJAX_PATHS, WEIBO_IMAGE_ORIGIN, WEIBO_WEB_ORIGIN } from './weiboEndpoints'
import type { TimelinePage, TimelinePageQuery } from './webClient'

/** 英文月份 → 0 起月份：微博 created_at 固定输出英文缩写 */
const MONTH_INDEX: Readonly<Record<string, number>> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
}

/** 取数入参：在协议入参之上补齐凭证与可注入的请求实现 */
export interface FetchTimelineOptions extends WeiboTimelineRequest {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    /** 请求实现替身：单测不触网 */
    requestPage?: (query: TimelinePageQuery) => Promise<TimelinePage>
    /** 时刻来源替身：保证 fetchedAt 可断言 */
    now?: () => Date
}

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本，其余类型返回空串，避免对象被隐式转成 [object Object] */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 计数取值：非负整数以外一律按 0 */
function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** 解码微博正文里的实体：先剥标签再解码，避免解码出的尖括号被二次当作标签 */
function decodeEntities(text: string): string {
    return text
        .replace(/&nbsp;/giu, ' ')
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>')
        .replace(/&quot;/giu, '"')
        .replace(/&#39;|&apos;/giu, "'")
        .replace(/&amp;/giu, '&')
        .replace(/&#(\d{1,6});/gu, (_, code: string) => String.fromCodePoint(Number(code)))
}

/**
 * 正文清洗：保留换行语义，剥掉全部标签，解实体，去零宽字符。
 * 微博正文里的图片、话题与 @ 都会以 <a> 形式出现，去标签后仍是可读文本。
 */
export function stripWeiboHtml(html: string): string {
    const withBreaks = html.replace(/<br\s*\/?>/giu, '\n')
    const withoutTags = withBreaks.replace(/<[^>]+>/gu, '')
    return decodeEntities(withoutTags)
        .replace(/[\u200B-\u200F\uFEFF]/gu, '')
        .replace(/\n{3,}/gu, '\n\n')
        .trim()
}

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
function buildSinaImageUrl(pid: string): string | null {
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

/**
 * 读取标签属性：单双引号与无引号值都支持，返回值做实体解码。
 * 属性名要求前有边界，避免 `data-href` 之类被当成 `href`；无引号值去掉自闭合标签的尾斜杠。
 * 属性名由调用方给常量，不参与正则转义。
 */
function readAttribute(tag: string, name: string): string {
    const pattern = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu')
    const match = pattern.exec(tag)
    if (match === null) {
        return ''
    }
    const quoted = match[1] ?? match[2]
    const value = quoted ?? (match[3] ?? '').replace(/\/$/u, '')
    return decodeEntities(value).trim()
}

/** 追加纯文本片段：与上一段同为文本时直接拼接，避免产生大量碎片 */
function pushPlainText(segments: WeiboTimelineSegment[], text: string): void {
    if (text.length === 0) {
        return
    }
    const last = segments[segments.length - 1]
    if (last !== undefined && last.type === 'text') {
        segments[segments.length - 1] = { type: 'text', text: last.text + text }
        return
    }
    segments.push({ type: 'text', text })
}

/** 追加 HTML 片段：先清洗再落成文本段 */
function pushHtmlText(segments: WeiboTimelineSegment[], html: string): void {
    pushPlainText(segments, stripWeiboHtml(html))
}

/**
 * 长文摘要末尾的展开提示：可能是 `<a>展开</a>`、`<a>...展开</a>`、`<a>展开全文</a>`。
 * 卡片上另有展开按钮，正文里不需要再留一份，先在 HTML 层剥掉带链接的那一种。
 */
const EXPAND_LINK_PATTERN = /<a\b[^>]*>\s*(?:\.{2,}|…+|。{2,})?\s*展开(?:全文)?\s*<\/a>/giu

/** 摘要末尾的纯文本展开提示：省略号 + 「展开」/「展开全文」，允许尾巴再跟标点 */
const TRAILING_EXPAND_PATTERN = /(?:\s*(?:\.{2,}|…+|。{2,})\s*)+展开(?:全文)?[.。…]*\s*$/u

/** 摘要末尾的截断省略号：链接被剥掉后会单独剩下 `……`，需要一并清掉 */
const TRAILING_ELLIPSIS_PATTERN = /(?:\s*(?:\.{2,}|…+|。{2,}))+\s*$/u

/** 长文痕迹：正文末尾的「展开 / 展开全文」，可能裹在标签里（`<a>展开全文</a>`、`<span class="expand">展开</span>`） */
const LONG_TEXT_MARKER_PATTERN = /(?:展开全文|展开)(?:<[^>]*>)*\s*$/u

/** 去掉「展开」链接：只处理带 <a> 外壳的那一处，正文里的普通用词不受影响 */
function removeExpandLink(html: string): string {
    return html.replace(EXPAND_LINK_PATTERN, '')
}

/**
 * 去掉末尾的截断痕迹：先删「……展开」，再删可能剩下的省略号。
 * 只对长文摘要调用，避免误伤普通正文里同样的写法。
 */
function stripTrailingTruncation(text: string): string {
    return text.replace(TRAILING_EXPAND_PATTERN, '').replace(TRAILING_ELLIPSIS_PATTERN, '').trimEnd()
}

/** 清理最后一个文本段末尾的截断痕迹：清空后整段移除，避免留下空段落 */
function removeTrailingExpandHint(segments: WeiboTimelineSegment[]): void {
    const last = segments[segments.length - 1]
    if (last === undefined || last.type !== 'text') {
        return
    }
    const cleaned = stripTrailingTruncation(last.text)
    if (cleaned.length === 0) {
        segments.pop()
        return
    }
    segments[segments.length - 1] = { type: 'text', text: cleaned }
}

/**
 * 没有 HTML 锚点时的纯文本分段：@账号、话题与微博域名链接同样切出来可点，
 * 空正文返回空数组，调用方据此显示「无正文」。
 */
function buildTextSegments(text: string): WeiboTimelineSegment[] {
    return splitPlainTextLinks(text)
}

/**
 * 把表情 img 还原成 `[名称]` 文本。
 * 纯文本口径（转发摘要、text 字段）不需要图片，但直接剥标签会把表情名一起丢掉。
 */
function replaceEmojiWithText(html: string): string {
    return html.replace(/<img\b[^>]*>/giu, (tag) => {
        const name = readAttribute(tag, 'title') || readAttribute(tag, 'alt')
        return name.length > 0 ? `[${name}]` : ''
    })
}

/**
 * 正文链接的主机白名单：微博主站与其子域承载 @账号、话题、超话页，
 * t.cn 是新浪自家短链服务（正文里的外链一律先经它跳转）。
 * 关键约束：不在名单内的地址不生成链接段，降级为纯文本——Webview 只负责展示，不承担导航。
 */
const WEIBO_LINK_HOSTS = ['weibo.com', 'weibo.cn', 't.cn'] as const

/** 主机是否在链接白名单后缀下：精确相等或点分后缀，避免 sub.host.evil.com 绕过 */
function isWeiboLinkHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return WEIBO_LINK_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * 归一化正文链接：兼容协议相对写法（`//weibo.com/u/123`），统一升级为 https。
 * 只接受 https 且主机在白名单内，其余返回 null 由调用方降级成纯文本。
 */
export function normalizeWeiboLinkUrl(value: unknown): string | null {
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
    if (parsed.protocol !== 'https:' || !isWeiboLinkHost(parsed.hostname)) {
        return null
    }
    return parsed.toString()
}

/**
 * 判定链接分类：超话页在 `/p/` 下，话题页带搜索参数 q，个人主页在 `/u/`、`/n/`、`/profile/`
 * 或纯 uid 路径下，其余（短链、文章页、其它微博详情）归为普通链接。
 * 文本以 @ 开头时优判为 @账号，兼容 href 不可解析的 usercard 写法。
 */
function classifyLinkKind(url: URL, text: string): WeiboTimelineLinkKind {
    const path = url.pathname
    if (/^\/p\/[0-9A-Za-z]+/u.test(path)) {
        return 'supertopic'
    }
    if (url.searchParams.has('q')) {
        return 'topic'
    }
    if (/^\/(?:u|n|profile)\/[^/]+$/u.test(path) || /^\/\d{4,}\/?$/u.test(path) || text.startsWith('@')) {
        return 'mention'
    }
    return 'link'
}

/** 正文里的锚点与表情图：一次扫描保留两者在上游 HTML 里的原始先后 */
const CONTENT_TAG_PATTERN = /<a\b[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>/giu

/** 锚点内部拆出外层标签与内层内容：非贪婪匹配到最近的闭标签 */
const ANCHOR_PARTS_PATTERN = /^<a\b[^>]*>([\s\S]*?)<\/a>$/iu

/** 是否为锚点开标签 */
const ANCHOR_OPEN_PATTERN = /^<a\b/iu

/** usercard 属性里的账号 id：形如 `id=1234567890`，可与其它键值以 ; 分隔 */
const USERCARD_ID_PATTERN = /(?:^|[;\s])id=(\d{1,25})(?:$|[;\s])/u

/** 锚点内部文本的 @账号形态：昵称整体在锚点内，允许含空格与符号 */
const ANCHOR_MENTION_PATTERN = /^@(\S.{0,38})$/u

/**
 * 解析锚点地址：href 优先；href 不可用（`javascript:void(0)`、缺失、属性无引号被截断）时，
 * 依次回退 usercard 里的 uid 与内部文本（@昵称走 /n/ 主页）。
 * 关键约束：回退只认可确定归属的文本形态——@ 前缀才能确认是账号，其余锚点仍按纯文本展平，
 * 避免把 `#标题#` 这类普通文字误判成话题。
 */
function resolveAnchorUrl(tag: string, text: string): string | null {
    const direct = normalizeWeiboLinkUrl(readAttribute(tag, 'href'))
    if (direct !== null) {
        return direct
    }
    const uid = USERCARD_ID_PATTERN.exec(readAttribute(tag, 'usercard'))?.[1]
    if (uid !== undefined) {
        return `${WEIBO_WEB_ORIGIN}/u/${uid}`
    }
    const mention = ANCHOR_MENTION_PATTERN.exec(text)?.[1]
    if (mention !== undefined) {
        return `${WEIBO_WEB_ORIGIN}/n/${encodeURIComponent(mention)}`
    }
    return null
}

/**
 * 追加一个锚点：@账号、#话题#、#超话# 与短链落成链接段，其余情况退回纯文本。
 * 关键约束：内层带图片的锚点是视频 / 文章卡片，不当作正文文本链接——
 * 这里只消费开标签，让内层 img 与文字继续走原有的表情与文本逻辑，图片不会被整块吞掉。
 */
function pushAnchorSegment(segments: WeiboTimelineSegment[], tag: string): void {
    const inner = ANCHOR_PARTS_PATTERN.exec(tag)?.[1] ?? ''
    const text = stripWeiboHtml(inner)
    const url = text.length === 0 ? null : resolveAnchorUrl(tag, text)
    if (url === null) {
        pushPlainText(segments, text)
        return
    }
    segments.push({ type: 'link', text, url, kind: classifyLinkKind(new URL(url), text) })
}

/**
 * 表情名形态：非空、长度有限且不是地址。
 * 卡片装饰图（如视频卡片的默认小图）的 alt 常是一串短链，不能被当成表情名渲染。
 */
function isEmoticonLabel(name: string): boolean {
    const trimmed = name.trim()
    return trimmed.length > 0 && trimmed.length <= 16 && !/^https?:/iu.test(trimmed)
}

/**
 * 把正文 HTML 切成「文本 + 表情 + 链接」片段，三者保持上游原顺序。
 * 表情图只接受微博图床地址；非白名单域名或缺少直链时降级成 `[表情名]` 文本，不丢信息。
 * 没有表情名的 img 属卡片装饰图，直接跳过：既不作表情，也不留 `[]` 占位。
 * 锚点只在 href 落在微博域名白名单内时落成链接段，其余按纯文本展平，不把越界地址带进前端。
 */
export function parsePostSegments(html: string): WeiboTimelineSegment[] {
    const segments: WeiboTimelineSegment[] = []
    if (html.length === 0) {
        return segments
    }
    let lastIndex = 0
    for (const match of html.matchAll(CONTENT_TAG_PATTERN)) {
        const index = match.index ?? 0
        pushHtmlText(segments, html.slice(lastIndex, index))
        const tag = match[0]
        const isAnchor = ANCHOR_OPEN_PATTERN.test(tag)
        // 含图片的锚点是卡片链接：只消费开标签，内层 img 与文字继续按原有逻辑切分
        if (isAnchor && !/<img\b/iu.test(tag)) {
            lastIndex = index + tag.length
            pushAnchorSegment(segments, tag)
            continue
        }
        // 先推进游标：装饰图在下面的分支里直接跳过，不再重复更新
        lastIndex = index + (isAnchor ? tag.indexOf('>') + 1 : tag.length)
        if (isAnchor) {
            continue
        }
        const name = readAttribute(tag, 'title') || readAttribute(tag, 'alt')
        if (!isEmoticonLabel(name)) {
            continue
        }
        const url = normalizeWeiboImageUrl(readAttribute(tag, 'src'))
        if (url !== null) {
            segments.push({ type: 'emoji', name, url })
        } else {
            pushPlainText(segments, `[${name}]`)
        }
    }
    pushHtmlText(segments, html.slice(lastIndex))
    return segments
}

/**
 * 解析微博时间：主格式形如 `Wed Nov 19 10:00:00 +0800 2026`，带时区偏移。
 * 解析失败返回空串而不是抛错——单条时间异常不该阻断整页。
 */
export function parseWeiboCreatedAt(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
        return ''
    }
    const match = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/u.exec(
        trimmed,
    )
    if (match !== null) {
        const [, monthName, day, hour, minute, second, sign, tzHour, tzMinute, year] = match
        const month = monthName === undefined ? undefined : MONTH_INDEX[monthName]
        if (
            month !== undefined &&
            day !== undefined &&
            hour !== undefined &&
            minute !== undefined &&
            second !== undefined &&
            sign !== undefined &&
            tzHour !== undefined &&
            tzMinute !== undefined &&
            year !== undefined
        ) {
            const offsetMinutes = (sign === '+' ? 1 : -1) * (Number(tzHour) * 60 + Number(tzMinute))
            const utcMs =
                Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)) -
                offsetMinutes * 60_000
            return new Date(utcMs).toISOString()
        }
    }
    const fallback = new Date(trimmed)
    return Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString()
}

/** 单张图片的候选信息：原图、展示图与上游给出的原图尺寸 */
interface MediaCandidate {
    /** 原图直链：保存到笔记等需要最大尺寸的场合使用，优先 largest（画质最好） */
    url: string
    /** 展示图直链：九宫格与卡片内预览使用，优先上游 large 档（长边 960） */
    middleUrl: string | null
    /** 原图尺寸：优先 largest 档（最大可用尺寸），缺失回退 original / large */
    size: WeiboTimelineImageSize | null
}

/** 读取档位宽高：宽高都为正数才算有效 */
function readVariantSize(variant: unknown): WeiboTimelineImageSize | null {
    if (!isRecord(variant)) {
        return null
    }
    const width = toCount(variant.width)
    const height = toCount(variant.height)
    return width > 0 && height > 0 ? { width, height } : null
}

/** 读取档位直链：非白名单域名视为不可用 */
function readVariantUrl(variant: unknown): string | null {
    if (!isRecord(variant)) {
        return null
    }
    return normalizeWeiboImageUrl(toText(variant.url))
}

/**
 * 读取单张图片的候选信息：原图直链、展示图直链与上游给出的最大尺寸。
 * 关键约束：展示图优先取上游 `large` 档（长边 960）——九宫格与卡片内预览都用它，
 * bmiddle 档长边只有 360，铺到卡片宽度会明显发虚；两档都没有时才把原图目录换成 bmiddle 兜底。
 */
function pickMediaCandidate(value: unknown): MediaCandidate | null {
    if (!isRecord(value)) {
        return null
    }
    const size = readVariantSize(value.largest) ?? readVariantSize(value.original) ?? readVariantSize(value.large)
    const url =
        readVariantUrl(value.largest) ??
        readVariantUrl(value.original) ??
        readVariantUrl(value.large) ??
        readVariantUrl(value.bmiddle) ??
        normalizeWeiboImageUrl(toText(value.url))
    if (url === null) {
        return null
    }
    const middleUrl = readVariantUrl(value.large) ?? readVariantUrl(value.bmiddle) ?? buildMiddleImageUrl(url)
    return { url, middleUrl, size }
}

/**
 * 渐进式整段 mp4 字段：`<video>` 能直接播放的只有这些，按清晰度优先取第一个可用地址。
 * 关键约束：`playback_list` 里是 DASH 分片（带 init / index range），不能直接播放，一律不取。
 */
const PROGRESSIVE_VIDEO_KEYS = ['mp4_720p_mp4', 'mp4_hd_url', 'mp4_sd_url', 'stream_url_hd', 'stream_url'] as const

/** 取可直接播放的整段 mp4 地址：没有则返回 null，前端回退「打开原文」 */
function pickProgressiveUrl(mediaInfo: unknown): string | null {
    if (!isRecord(mediaInfo)) {
        return null
    }
    for (const key of PROGRESSIVE_VIDEO_KEYS) {
        const url = normalizeWeiboVideoUrl(toText(mediaInfo[key]))
        if (url !== null) {
            return url
        }
    }
    return null
}

/** 仅有 pid 时拼图床直链：部分返回只给 id 不给直链 */
function candidateFromPid(pid: string): MediaCandidate | null {
    const url = buildSinaImageUrl(pid)
    return url === null ? null : { url, middleUrl: buildMiddleImageUrl(url), size: null }
}

/** 混排项是否为视频：type 为主，data 里的 object_type / type 兜底（新版把类型下沉到 data） */
function isVideoItem(item: Record<string, unknown>): boolean {
    if (item.type === 'video') {
        return true
    }
    const data = item.data
    return isRecord(data) && (data.object_type === 'video' || data.type === 'video')
}

/** 视频摘要：封面、时长、可播放的整段地址与最大分辨率；播放地址带签名且校验 Referer，由宿主取回后再播 */
interface VideoCandidate {
    coverUrl: string | null
    coverMiddleUrl: string | null
    durationSeconds: number | null
    playUrl: string | null
    resolution: WeiboTimelineVideoResolution | null
}

/**
 * 取视频最大分辨率：优先 playback_list 里面积最大的一档（每档都带 width / height），
 * 没有播放列表时退回解析 progressive 地址上的 `template=720x960.24.0`。
 * 关键约束：角标只标「最大尺寸」，不能拿封面尺寸充数——封面档位与视频分辨率无关。
 */
function pickMaxResolution(mediaInfo: unknown): WeiboTimelineVideoResolution | null {
    if (!isRecord(mediaInfo)) {
        return null
    }
    let best: WeiboTimelineVideoResolution | null = null
    const playbackList = mediaInfo.playback_list
    if (Array.isArray(playbackList)) {
        for (const entry of playbackList) {
            if (!isRecord(entry) || !isRecord(entry.play_info)) {
                continue
            }
            const width = toCount(entry.play_info.width)
            const height = toCount(entry.play_info.height)
            if (width <= 0 || height <= 0) {
                continue
            }
            if (best === null || width * height > best.width * best.height) {
                best = { width, height }
            }
        }
    }
    if (best !== null) {
        return best
    }
    for (const key of PROGRESSIVE_VIDEO_KEYS) {
        const match = /[?&]template=(\d{2,5})x(\d{2,5})/u.exec(toText(mediaInfo[key]))
        if (match !== null) {
            const width = Number(match[1])
            const height = Number(match[2])
            if (width > 0 && height > 0) {
                return { width, height }
            }
        }
    }
    return null
}

/**
 * 读取视频封面与时长：封面优先 pic_info 的档位地址，其次 page_pic 单直链；
 * 时长兼容三处写法（data.duration、media_info.duration、duration_time）。
 */
function pickVideoCandidate(data: Record<string, unknown>): VideoCandidate {
    const fromPic = pickMediaCandidate(data.pic_info) ?? pickMediaCandidate(data.page_info)
    const pageInfo = isRecord(data.page_info) ? data.page_info : {}
    // 封面有三处写法：pic_info 的档位对象、data.page_pic、data.page_info.page_pic
    const direct =
        fromPic === null
            ? (normalizeWeiboImageUrl(toText(data.page_pic)) ?? normalizeWeiboImageUrl(toText(pageInfo.page_pic)))
            : null
    const coverUrl = fromPic === null ? direct : fromPic.url
    const mediaInfo = isRecord(data.media_info)
        ? data.media_info
        : isRecord(pageInfo.media_info)
          ? pageInfo.media_info
          : {}
    const duration = toCount(data.duration) || toCount(mediaInfo.duration) || toCount(data.duration_time)
    return {
        coverUrl,
        coverMiddleUrl: fromPic?.middleUrl ?? (coverUrl === null ? null : buildMiddleImageUrl(coverUrl)),
        durationSeconds: duration > 0 ? duration : null,
        playUrl: pickProgressiveUrl(mediaInfo),
        resolution: pickMaxResolution(mediaInfo),
    }
}

/**
 * 提取媒体摘要：图文与视频按 mix_media_info.items 原序落 items，三个图片数组由它派生。
 * 关键约束：混排项是唯一顺序来源——先按 items 走一遍，pic_infos 只补混排里没出现的图，
 * 避免「先全部图片再视频」把图文交错的顺序压平；视频只取封面与时长，播放地址仅留在 videoUrl 供兜底诊断。
 */
function extractMedia(record: Record<string, unknown>): WeiboTimelineMedia {
    const items: WeiboTimelineMediaItem[] = []
    const images: string[] = []
    const imageIds: string[] = []
    const thumbnails: string[] = []
    const sizes: Array<WeiboTimelineImageSize | null> = []
    /** 已收录的 pid 与原图地址：pic_infos 与 mix_media_info 是同一批图的两种视图 */
    const seenPids = new Set<string>()
    const seenUrls = new Set<string>()

    /** 追加一张图：pid 与直链双重去重，三个数组保持同序，前端按索引配对 */
    const pushImage = (candidate: MediaCandidate | null, pid?: string): void => {
        if (candidate === null) {
            return
        }
        if (pid !== undefined && seenPids.has(pid)) {
            return
        }
        if (seenUrls.has(candidate.url)) {
            return
        }
        if (pid !== undefined) {
            seenPids.add(pid)
        }
        seenUrls.add(candidate.url)
        const middleUrl = candidate.middleUrl ?? buildMiddleImageUrl(candidate.url)
        images.push(candidate.url)
        // pid 与图片同序：缺失时为空的占位串，调用方据此回退直链下载
        imageIds.push(pid ?? '')
        thumbnails.push(middleUrl)
        sizes.push(candidate.size)
        items.push({ kind: 'image', url: candidate.url, middleUrl, size: candidate.size })
    }

    let videoUrl: string | null = null
    let videoCount = 0

    // 混排项：图片与视频按上游原序落 items，视频不占图片格
    const mixMedia = record.mix_media_info
    if (isRecord(mixMedia) && Array.isArray(mixMedia.items)) {
        for (const raw of mixMedia.items) {
            if (!isRecord(raw)) {
                continue
            }
            if (isVideoItem(raw)) {
                const data = isRecord(raw.data) ? raw.data : raw
                const candidate = pickVideoCandidate(data)
                items.push({
                    kind: 'video',
                    coverUrl: candidate.coverUrl,
                    coverMiddleUrl: candidate.coverMiddleUrl,
                    durationSeconds: candidate.durationSeconds,
                    playUrl: candidate.playUrl,
                    resolution: candidate.resolution,
                })
                videoCount += 1
                if (videoUrl === null) {
                    videoUrl = candidate.playUrl
                }
                continue
            }
            const rawPid = toText(raw.id) || toText(raw.pid) || toText(isRecord(raw.data) ? raw.data.id : '')
            const pid = rawPid.length > 0 ? rawPid : undefined
            const candidate =
                pickMediaCandidate(raw.data) ??
                pickMediaCandidate(raw) ??
                (pid === undefined ? null : candidateFromPid(pid))
            pushImage(candidate, pid)
        }
    }

    // 部分版本只在 pic_infos 给图、mix_media_info 只给视频：混排没收录的图按 pid 顺序补在尾部
    const picInfos = record.pic_infos
    if (isRecord(picInfos)) {
        for (const [pid, info] of Object.entries(picInfos)) {
            pushImage(pickMediaCandidate(info) ?? candidateFromPid(pid), pid)
        }
    }

    // 兜底：只有 pic_ids 没有直链时用 pid 拼图床地址，否则图片区是空的
    if (Array.isArray(record.pic_ids)) {
        for (const rawPid of record.pic_ids) {
            const pid = toText(rawPid)
            pushImage(pid.length === 0 ? null : candidateFromPid(pid), pid.length === 0 ? undefined : pid)
        }
    }
    for (const key of ['original_pic', 'bmiddle_pic', 'thumbnail_pic']) {
        const url = normalizeWeiboImageUrl(toText(record[key]))
        if (url !== null) {
            pushImage({ url, middleUrl: buildMiddleImageUrl(url), size: null })
        }
    }

    /**
     * 顶层 page_info 的视频卡片：补一个视频项，卡片才有封面与播放入口。
     * 视频标识有三种：新版给 `object_type: video` / `type: 11`，旧版没有类型标识、只有整段播放地址；
     * 群组与投票卡片同样带 page_pic 却没有播放地址，不能只凭封面就当成视频。
     */
    const pageInfo = record.page_info
    if (isRecord(pageInfo)) {
        const hasVideoType = pageInfo.object_type === 'video' || pageInfo.type === 11
        const isLegacyVideo =
            pageInfo.object_type === undefined && pageInfo.type === undefined
                ? pickProgressiveUrl(pageInfo.media_info) !== null
                : false
        if (videoCount === 0 && (hasVideoType || isLegacyVideo)) {
            const candidate = pickVideoCandidate(pageInfo)
            items.push({
                kind: 'video',
                coverUrl: candidate.coverUrl,
                coverMiddleUrl: candidate.coverMiddleUrl,
                durationSeconds: candidate.durationSeconds,
                playUrl: candidate.playUrl,
                resolution: candidate.resolution,
            })
            videoCount = 1
            if (videoUrl === null) {
                videoUrl = candidate.playUrl
            }
        }
    }

    const declared = toCount(record.pic_num)
    return {
        items,
        images,
        imageIds,
        thumbnails,
        sizes,
        videoUrl,
        // 只数图片：视频不占图片格，混排时也不再拿上游声明数冒充实际渲染数
        imageCount: Math.max(declared, images.length),
        videoCount,
    }
}

/** 读当前账号是否已赞：上游有对象与数字两种形态，缺失按未赞处理 */
function readIsLiked(record: Record<string, unknown>): boolean {
    const status = record.attitudes_status
    if (isRecord(status)) {
        return status.liked === true || status.liked === 1
    }
    return status === 1 || record.liked === true
}

/** 互动数据：字段名按微博原样映射，缺失按 0 */
function extractMetrics(record: Record<string, unknown>): WeiboTimelineMetrics {
    return {
        reposts: toCount(record.reposts_count),
        comments: toCount(record.comments_count),
        likes: toCount(record.attitudes_count),
    }
}

/** 拼原文地址：有 mblogid 时用 /{uid}/{mblogid}，否则退回 /detail/{id} */
function buildPostUrl(uid: string, mblogid: string, id: string): string {
    if (mblogid.length === 0) {
        return `${WEIBO_WEB_ORIGIN}/detail/${id}`
    }
    return uid.length > 0 ? `${WEIBO_WEB_ORIGIN}/${uid}/${mblogid}` : `${WEIBO_WEB_ORIGIN}/detail/${id}`
}

/**
 * 长文判定：上游 isLongText 会把「带视频卡片链接」的普通微博也标成 true，
 * 只有附带 continue_tag（「全文」入口）或正文末尾的展开痕迹才算真正被截断的长文；
 * longText 对象是旧版长文字段，命中即为长文。主贴与转发体共用同一份判定。
 */
function isLongTextRecord(record: Record<string, unknown>): boolean {
    if (isRecord(record.longText)) {
        return true
    }
    if (record.isLongText !== true) {
        return false
    }
    const rawHtml = toText(record.text)
    const textRaw = toText(record.text_raw)
    return (
        isRecord(record.continue_tag) ||
        LONG_TEXT_MARKER_PATTERN.test(rawHtml) ||
        LONG_TEXT_MARKER_PATTERN.test(textRaw)
    )
}

/**
 * 归一化转发体：保留摘要、作者、媒体与分段，不再递归展开（转发里再转发只按文字处理）。
 * 分段与主贴同源：用带标签的 text 切，正文里的 @账号、话题与链接同样可点。
 */
function normalizeRetweeted(value: unknown): WeiboTimelineRetweet | null {
    if (!isRecord(value)) {
        return null
    }
    const id = toText(value.idstr) || toText(value.id) || toText(value.mid)
    if (id.length === 0) {
        return null
    }
    const user = isRecord(value.user) ? value.user : {}
    const authorId = toText(user.id)
    const author = toText(user.screen_name)
    const textRaw = toText(value.text_raw)
    const plainText =
        textRaw.length > 0 ? stripWeiboHtml(textRaw) : stripWeiboHtml(replaceEmojiWithText(toText(value.text)))
    // 转发体同样可能是长文：卡片只展示摘要，保存笔记时宿主据此补取全文
    const isLongText = isLongTextRecord(value)
    const text = isLongText ? stripTrailingTruncation(plainText) : plainText
    const html = removeExpandLink(toText(value.text))
    const segments = html.length > 0 ? parsePostSegments(html) : buildTextSegments(text)
    if (isLongText) {
        removeTrailingExpandHint(segments)
    }
    const createdAtRaw = toText(value.created_at)
    return {
        id,
        authorId,
        authorName: author,
        // 与主贴作者同口径：认 verified 布尔，缺失按未认证处理
        authorIsVerified: user.verified === true,
        text,
        segments,
        url: buildPostUrl(authorId, toText(value.mblogid), id),
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        media: extractMedia(value),
        isLongText,
    }
}

/**
 * 是否为广告或推广位：这类条目没有稳定 id，混进时间线会污染增量游标。
 * 标记有三种形态：时间线的 ad_state、部分端点的 is_ad、点赞列表的驼峰 isAd，
 * 以及只打 mark 的推广位（mark 里带 WeiboADNatural）；全部按广告丢弃。
 */
function isPromoted(record: Record<string, unknown>): boolean {
    if (record.ad_state === 1 || record.is_ad === true || record.isAd === true) {
        return true
    }
    if (toText(record.mark).includes('WeiboADNatural')) {
        return true
    }
    return isRecord(record.promotion)
}

/**
 * 去掉媒体里的视频项：转发微博的外层与引用区会各渲染一次同一个视频，
 * 被转发内容已有视频时外层只保留图片，视频只留在引用区播。
 */
function withoutVideos(media: WeiboTimelineMedia): WeiboTimelineMedia {
    if (media.videoCount === 0) {
        return media
    }
    return {
        ...media,
        items: media.items.filter((item) => item.kind !== 'video'),
        videoCount: 0,
        videoUrl: null,
    }
}

/**
 * 归一化单条微博。
 * 缺少数字 id 或属于广告位时返回 null，调用方据此跳过且不计数。
 */
export function normalizeTimelinePost(raw: unknown): WeiboTimelinePost | null {
    if (!isRecord(raw) || isPromoted(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id) || toText(raw.mid)
    if (id.length === 0) {
        return null
    }
    const mblogid = toText(raw.mblogid)
    const user = isRecord(raw.user) ? raw.user : {}
    const uid = toText(user.id)
    const avatar = toText(user.avatar_large) || toText(user.profile_image_url)
    const textRaw = toText(raw.text_raw)
    const rawHtml = toText(raw.text)
    const html = removeExpandLink(rawHtml)
    const isLongText = isLongTextRecord(raw)
    const plainText = textRaw.length > 0 ? stripWeiboHtml(textRaw) : stripWeiboHtml(replaceEmojiWithText(html))
    // 长文摘要末尾常带「……展开」：卡片已有展开按钮，正文里再留一份会造成重复提示
    const text = isLongText ? stripTrailingTruncation(plainText) : plainText
    // 表情只存在于带标签的 text 里：text_raw 会把表情压成 [名称] 纯文本，无法还原成图片
    const segments = html.length > 0 ? parsePostSegments(html) : buildTextSegments(text)
    if (isLongText) {
        removeTrailingExpandHint(segments)
    }
    const createdAtRaw = toText(raw.created_at)
    const retweeted = normalizeRetweeted(raw.retweeted_status)
    const media = extractMedia(raw)
    // 转发微博外层不重复展示视频：被转发内容已带视频时，视频只留在引用区
    const visibleMedia = retweeted !== null && retweeted.media.videoCount > 0 ? withoutVideos(media) : media

    return {
        id,
        mblogid,
        url: buildPostUrl(uid, mblogid, id),
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        source: stripWeiboHtml(toText(raw.source)),
        author: {
            id: uid,
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
            isVerified: user.verified === true,
        },
        metrics: extractMetrics(raw),
        media: visibleMedia,
        retweeted,
        isLiked: readIsLiked(raw),
        isLongText,
    }
}

/** 夹取翻页数：非法值取 1，超出上限按上限 */
function clampMaxPages(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.min(Math.max(Math.trunc(value), 1), WEIBO_TIMELINE_MAX_PAGES)
}

/** 游标清洗：空串与非数字一律视为未指定 */
function normalizeCursor(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
}

/**
 * 拉取关注时间线。
 * 首屏与翻页走同一入口：带 maxId 即向后翻页，带 sinceId 即增量（只取一页）。
 */
export async function fetchFriendTimeline(options: FetchTimelineOptions): Promise<WeiboTimelineResult> {
    const requestPage = options.requestPage ?? requestTimelinePage
    const now = options.now ?? ((): Date => new Date())
    const maxPages = clampMaxPages(options.maxPages)
    const sinceCursor = normalizeCursor(options.sinceId)
    const isIncremental = sinceCursor !== null && sinceCursor !== '0'
    let cursor = normalizeCursor(options.maxId)
    let nextCursor: string | null = cursor
    let lastPage: TimelinePage | null = null
    let pages = 0
    let droppedDuplicates = 0
    const seen = new Set<string>()
    const posts: WeiboTimelinePost[] = []

    while (pages < maxPages) {
        const page = await requestPage({
            cookie: options.cookie,
            uid: options.uid,
            sinceId: isIncremental ? sinceCursor : '0',
            maxId: cursor,
            count: options.count,
            refresh: options.refresh,
            timeoutMs: options.timeoutMs,
            minIntervalMs: options.minIntervalMs,
        })
        pages += 1
        lastPage = page
        for (const raw of page.statuses) {
            const post = normalizeTimelinePost(raw)
            if (post === null) {
                continue
            }
            if (seen.has(post.id)) {
                droppedDuplicates += 1
                continue
            }
            seen.add(post.id)
            posts.push(post)
        }

        const pageNext = normalizeCursor(page.maxId)
        // 增量只取第一页：再往后翻就变成补历史，与「看新内容」的语义相反
        if (isIncremental) {
            nextCursor = null
            break
        }
        if (page.statuses.length === 0 || pageNext === null || pageNext === cursor) {
            nextCursor = null
            break
        }
        nextCursor = pageNext
        cursor = pageNext
    }

    // 增量起点优先取上游 since_id：首页 unreadfriendstimeline 返回的是读进度游标（与微博 id 不同量级），
    // 用首条微博 id 覆盖会让下次增量传错游标；分组 / 时间线的 since_id 恰好等于首条 id，两种口径等价。
    const sinceId = lastPage?.sinceId ?? posts[0]?.id ?? null
    return {
        posts,
        sinceId,
        maxId: nextCursor,
        hasMore: nextCursor !== null && posts.length > 0,
        pages,
        fetchedAt: now().toISOString(),
        droppedDuplicates,
    }
}
