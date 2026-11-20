/**
 * 微博正文纯文本切分：把 @账号、#话题# 与微博域名链接切成分段。
 * 复用约定：宿主（正文缺 HTML 锚点时）与 Webview（长文全文只有纯文本）共用这一份规则，
 * 输出与 WeiboTimelineSegment 对齐，前端直接交给 WeiboRichText 渲染；零前端依赖，宿主可直接引用。
 * 关键约束：只对微博域名（含 t.cn）生成链接段，越界地址保留原文；
 * 昵称以空白与常见分隔符为界，含空格的昵称无法确定边界，只切到第一个分隔符。
 */
import type { WeiboTimelineSegment } from '@shared/types/weibo'

/** 昵称主页基址：纯文本里只有昵称、没有 uid 时用它跳转 */
const MENTION_URL_BASE = 'https://weibo.com/n'

/** 话题搜索页基址：参数由 buildTopicSearchUrl 拼接 */
const TOPIC_SEARCH_URL_BASE = 'https://s.weibo.com/weibo'

/** 链接主机白名单：与宿主 weibo/openPost 的放行名单保持一致 */
const WEIBO_LINK_HOSTS = ['weibo.com', 'weibo.cn', 't.cn'] as const

/** 话题形态：井号包裹且内部不含井号与空白 */
const TOPIC_PATTERN = /^#[^#\s]{1,40}#$/u

/**
 * 纯文本里的可识别对象：@昵称、#话题#、http(s) 链接。
 * 关键约束：@ 只吃到空白与常见分隔符为止，避免把句末标点并进昵称；
 * @ 前若紧邻邮箱本地部分字符（字母数字与 . _ % + -）则不算账号，避免把 a@b.com 当成 mention；
 * URL 排除中文标点，防止把句号、书名号一并吞进地址。
 */
const PLAIN_TEXT_LINK_PATTERN =
    /(?<![\w.%+-])@[^\s@#,，。、；;：:！!？?&<>"'/\\|]{1,40}|#[^#\s]{1,40}#|https?:\/\/[^\s<>"'，。、；：！？（）【】《》]+/gu

/** 昵称主页地址：纯文本里只有昵称时使用 */
export function buildMentionUrl(name: string): string {
    return `${MENTION_URL_BASE}/${encodeURIComponent(name)}`
}

/** 话题搜索页地址：话题词按 URL 规则转码 */
export function buildTopicSearchUrl(topic: string): string {
    return `${TOPIC_SEARCH_URL_BASE}?q=${encodeURIComponent(topic)}`
}

/** 主机是否在链接白名单后缀下：精确相等或点分后缀，避免 sub.host.evil.com 绕过 */
function isWeiboLinkHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return WEIBO_LINK_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * 归一化纯文本里的链接：只接受 http(s)，统一升级为 https，主机须在微博白名单内。
 * 返回 null 时调用方保留原文，不渲染成必然打不开的链接。
 */
function normalizePlainUrl(raw: string): string | null {
    let parsed: URL
    try {
        parsed = new URL(raw)
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

/** 单个纯文本对象 → 分段：识别不了或越界的地址退回纯文本，不丢内容 */
function toLinkSegment(token: string): WeiboTimelineSegment | null {
    if (token.startsWith('@')) {
        const name = token.slice(1)
        return name.length > 0 ? { type: 'link', text: token, url: buildMentionUrl(name), kind: 'mention' } : null
    }
    if (token.startsWith('#')) {
        return TOPIC_PATTERN.test(token)
            ? { type: 'link', text: token, url: buildTopicSearchUrl(token), kind: 'topic' }
            : null
    }
    const url = normalizePlainUrl(token)
    return url === null ? null : { type: 'link', text: token, url, kind: 'link' }
}

/**
 * 把纯文本切成「文本 + 链接」分段：宿主在正文缺 HTML 锚点时、Webview 在长文全文里都用它。
 * 无匹配时返回单段文本，调用方无需额外判空；空串返回空数组。
 */
export function splitPlainTextLinks(text: string): WeiboTimelineSegment[] {
    const segments: WeiboTimelineSegment[] = []
    let lastIndex = 0
    for (const match of text.matchAll(PLAIN_TEXT_LINK_PATTERN)) {
        const index = match.index ?? 0
        const token = match[0]
        const segment = toLinkSegment(token)
        if (segment === null) {
            continue
        }
        if (index > lastIndex) {
            segments.push({ type: 'text', text: text.slice(lastIndex, index) })
        }
        segments.push(segment)
        lastIndex = index + token.length
    }
    if (lastIndex < text.length) {
        segments.push({ type: 'text', text: text.slice(lastIndex) })
    }
    if (segments.length > 0) {
        return segments
    }
    return text.length > 0 ? [{ type: 'text', text }] : []
}
