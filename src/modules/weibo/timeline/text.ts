/**
 * 微博正文解析：把上游 HTML 收敛成「文本 + 表情 + 链接」片段，并清洗成长文摘要可用的纯文本。
 * 复用约定：接入方按片段渲染，不再二次解析 HTML；链接与表情地址统一走 timeline/media 的白名单收窄。
 * 关键约束：正文 HTML 超过上限或锚点不成对时不走标签解析（惰性匹配正则会退化成平方级扫描）；
 * 链接只认微博域名白名单，越界地址降级为纯文本，避免把任意地址带进 Webview；
 * 长文痕迹只可能出现在末尾，正则只看尾部固定长度，避免嵌套量词回溯。
 */
import type { WeiboTimelineLinkKind, WeiboTimelineSegment } from '@shared/types/weibo'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import { normalizeWeiboImageUrl } from './media'
import { WEIBO_WEB_ORIGIN } from '../endpoints'

/** 正文 HTML 上限：超过后不再做标签解析，直接退化成纯文本（普通微博正文远小于此值） */
const MAX_POST_HTML_LENGTH = 12_000

/** 长文痕迹只可能在正文末尾：正则只看尾部这么多字符，顺带消除嵌套量词的回溯面 */
export const LONG_TEXT_TAIL_LENGTH = 200

/** 属性正则缓存：属性名由调用方给常量，同一条微博里要读 2-3 次，重复编译纯属浪费 */
const ATTRIBUTE_PATTERN_CACHE = new Map<string, RegExp>()

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
export const LONG_TEXT_MARKER_PATTERN = /(?:展开全文|展开)(?:<[^>]*>)*\s*$/u

/**
 * 正文链接的主机白名单：微博主站与其子域承载 @账号、话题、超话页，
 * t.cn 是新浪自家短链服务（正文里的外链一律先经它跳转）。
 * 关键约束：不在名单内的地址不生成链接段，降级为纯文本——Webview 只负责展示，不承担导航。
 */
const WEIBO_LINK_HOSTS = ['weibo.com', 'weibo.cn', 't.cn'] as const

/** 正文里的锚点与表情图：一次扫描保留两者在上游 HTML 里的原始先后 */
const CONTENT_TAG_PATTERN = /<a\b[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>/giu

/** `<a` 之后的合法字符：空白、`>` 才算开标签，排除 `<article>`、`<aside>` 等 */
const ANCHOR_OPEN_FOLLOW_CHARS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x3e])

/** 锚点内部拆出外层标签与内层内容：非贪婪匹配到最近的闭标签 */
const ANCHOR_PARTS_PATTERN = /^<a\b[^>]*>([\s\S]*?)<\/a>$/iu

/** 是否为锚点开标签 */
const ANCHOR_OPEN_PATTERN = /^<a\b/iu

/** usercard 属性里的账号 id：形如 `id=1234567890`，可与其它键值以 ; 分隔 */
const USERCARD_ID_PATTERN = /(?:^|[;\s])id=(\d{1,25})(?:$|[;\s])/u

/** 锚点内部文本的 @账号形态：昵称整体在锚点内，允许含空格与符号 */
const ANCHOR_MENTION_PATTERN = /^@(\S.{0,38})$/u

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
 * 读取标签属性：单双引号与无引号值都支持，返回值做实体解码。
 * 属性名要求前有边界，避免 `data-href` 之类被当成 `href`；无引号值去掉自闭合标签的尾斜杠。
 * 属性名由调用方给常量，不参与正则转义；编译结果按属性名缓存。
 */
function readAttribute(tag: string, name: string): string {
    let pattern = ATTRIBUTE_PATTERN_CACHE.get(name)
    if (pattern === undefined) {
        pattern = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu')
        ATTRIBUTE_PATTERN_CACHE.set(name, pattern)
    }
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

/** 去掉「展开」链接：只处理带 <a> 外壳的那一处，正文里的普通用词不受影响 */
export function removeExpandLink(html: string): string {
    return html.replace(EXPAND_LINK_PATTERN, '')
}

/**
 * 去掉末尾的截断痕迹：先删「……展开」，再删可能剩下的省略号。
 * 只对长文摘要调用，避免误伤普通正文里同样的写法。
 */
export function stripTrailingTruncation(text: string): string {
    if (text.length === 0) {
        return text
    }
    // 痕迹只可能在末尾：只让尾部参与替换，长串省略号不会把整段正文拖进回溯
    const cut = Math.max(0, text.length - LONG_TEXT_TAIL_LENGTH)
    const tail = text.slice(cut).replace(TRAILING_EXPAND_PATTERN, '').replace(TRAILING_ELLIPSIS_PATTERN, '')
    return `${text.slice(0, cut)}${tail}`.trimEnd()
}

/** 清理最后一个文本段末尾的截断痕迹：清空后整段移除，避免留下空段落 */
export function removeTrailingExpandHint(segments: WeiboTimelineSegment[]): void {
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
export function buildTextSegments(text: string): WeiboTimelineSegment[] {
    return splitPlainTextLinks(text)
}

/**
 * 把表情 img 还原成 `[名称]` 文本。
 * 纯文本口径（转发摘要、text 字段）不需要图片，但直接剥标签会把表情名一起丢掉。
 */
export function replaceEmojiWithText(html: string): string {
    return html.replace(/<img\b[^>]*>/giu, (tag) => {
        const name = readAttribute(tag, 'title') || readAttribute(tag, 'alt')
        return name.length > 0 ? `[${name}]` : ''
    })
}

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

/**
 * 锚点是否成对：未闭合的 `<a` 会让 CONTENT_TAG_PATTERN 的惰性匹配退化到平方级扫描。
 * 关键约束：这里只做计数近似——上游正文正常闭合时恒为 false，异常时宁可退回纯文本。
 */
function hasUnbalancedAnchors(html: string): boolean {
    let open = 0
    let close = 0
    let index = html.indexOf('<a')
    while (index !== -1) {
        const follow = html.charCodeAt(index + 2)
        if (ANCHOR_OPEN_FOLLOW_CHARS.has(follow)) {
            open += 1
        }
        index = html.indexOf('<a', index + 2)
    }
    index = html.indexOf('</a>')
    while (index !== -1) {
        close += 1
        index = html.indexOf('</a>', index + 4)
    }
    return open > close
}

/**
 * 解析前的正文收窄：超长或锚点不成对时返回 null，调用方改用纯文本分段。
 * 关键约束：必须在任何标签正则之前调用，否则异常正文的扫描开销无法收敛。
 */
export function readPostHtml(rawHtml: string): string | null {
    if (rawHtml.length === 0 || rawHtml.length > MAX_POST_HTML_LENGTH) {
        return null
    }
    return hasUnbalancedAnchors(rawHtml) ? null : rawHtml
}

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
