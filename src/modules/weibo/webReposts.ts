/**
 * 微博转发：repostTimeline 读取谁转发了这条微博（按页码分页），normal_repost 提交转发（附言可空），
 * statuses/destroy 删除自己发的微博或转发；「评论并转发」走 webComments 的评论接口并带 is_repost=1，
 * 一次请求由上游同时生成评论与转发。
 * 复用约定：与时间线共用登录 Cookie 与错误分类；正文切段复用 webTimeline 的 parsePostSegments，
 * 时间与头像走同一套 parseWeiboCreatedAt / normalizeWeiboImageUrl，前端仍经 weibo/image 代理加载；
 * 写操作复用 webInteraction 的 XSRF 读取与 webPublish 的 fp 指纹生成。
 * 关键约束：分页只有 page 没有游标；回包 data 每项是本条转发（自带 retweeted_status，本层只用转发附言，
 * 不再展开被转发的原文）；纯转发没有附言，text 为空串；
 * 本页条数拉满就认为可能还有下一页，由前端一直翻到空页为止；转发是写操作，失败不重试。
 */
import type {
    WeiboDestroyStatusResult,
    WeiboRepostCreateResult,
    WeiboRepostItem,
    WeiboRepostMode,
    WeiboRepostsResult,
    WeiboTimelineSegment,
} from '@shared/types/weibo'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
import { createPostComment } from './webComments'
import { readXsrfToken } from './webInteraction'
import { buildStableFingerprint } from './webPublish'
import { normalizeWeiboImageUrl, parsePostSegments, parseWeiboCreatedAt, readIsLiked } from './webTimeline'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from './weiboEndpoints'

/** 单页默认条数：与网页端一致 */
export const WEIBO_REPOSTS_DEFAULT_COUNT = 10

/** 单页上限：转发列表一次拉太多没有意义 */
const MAX_REPOST_COUNT = 50

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

/** 转发（写操作）超时：与评论写操作同口径，失败要尽快让用户重试 */
const MUTATE_TIMEOUT_MS = 15_000

/** 转发列表请求参数 */
export interface FetchRepostsOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 页码：从 1 开始 */
    page?: number
    count?: number
    timeoutMs?: number
}

/** 删除微博参数：转发与自己发的微博都按 status id 删 */
export interface DestroyStatusOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    timeoutMs?: number
}

/** 转发提交参数 */
export interface CreateRepostOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 转发附言：纯转发传空串 */
    comment: string
    /** 转发方式：缺省只转发 */
    mode?: WeiboRepostMode
    timeoutMs?: number
    /** 指纹随机源：单测注入固定序列，生产用 Math.random */
    random?: () => number
}

/** 是否为普通对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本 */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 剥掉来源字段里的 HTML 外壳：「来自 <a>iPhone</a>」只留文字 */
function stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, '').trim()
}

/** 计数：数字与数字字符串都接受，缺失或非数值按 0，负数按 0（与时间线、评论同一口径） */
function toCount(value: unknown): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

/**
 * 点赞数：转发项与主贴同形，按字段优先级取第一个存在的值；一个都没有时回 null。
 * 关键约束：只认第一个命中的字段——0 是合法计数，不能因为它为假值就继续往后找；
 * null 与 0 必须区分：前者表示上游没下发，界面不显示数字，后者是真实的零赞。
 */
function readLikeCount(raw: Record<string, unknown>): number | null {
    for (const key of ['attitudes_count', 'attitude_count', 'like_counts']) {
        const value = raw[key]
        if (typeof value === 'number' || typeof value === 'string') {
            return toCount(value)
        }
    }
    return null
}

/** 夹取页码：非法值回落第一页 */
function clampPage(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.max(Math.trunc(value), 1)
}

/** 夹取条数：非法值回落默认，超出上限按上限 */
export function clampRepostCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return WEIBO_REPOSTS_DEFAULT_COUNT
    }
    return Math.min(Math.max(Math.trunc(value), 1), MAX_REPOST_COUNT)
}

/** 构造转发列表地址：只有 id / page / moduleID / count 四个参数 */
export function buildRepostsUrl(options: FetchRepostsOptions): string {
    const url = new URL(WEIBO_AJAX_PATHS.repostTimeline, WEIBO_WEB_ORIGIN)
    url.searchParams.set('id', options.id)
    url.searchParams.set('page', String(clampPage(options.page)))
    url.searchParams.set('moduleID', 'feed')
    url.searchParams.set('count', String(clampRepostCount(options.count)))
    return url.toString()
}

/**
 * 归一化单条转发：id 缺失直接丢弃，正文只取转发附言。
 * 命名带 Web 前缀，与时间线、评论的归一化函数保持同一命名口径。
 */
export function normalizeWebRepost(raw: unknown): WeiboRepostItem | null {
    if (!isRecord(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id)
    if (id.length === 0) {
        return null
    }
    const user = isRecord(raw.user) ? raw.user : {}
    const html = toText(raw.text)
    const segments: WeiboTimelineSegment[] = html.length > 0 ? parsePostSegments(html) : []
    // 纯文本口径：链接只留文字、表情还原成 [名称]，与评论列表一致
    const text = segments
        .map((segment) => {
            if (segment.type === 'text' || segment.type === 'link') {
                return segment.text
            }
            return segment.name.length > 0 ? `[${segment.name}]` : ''
        })
        .join('')
    const createdAtRaw = toText(raw.created_at)
    const avatar = toText(user.avatar_large) || toText(user.profile_image_url)
    const retweeted = isRecord(raw.retweeted_status) ? raw.retweeted_status : null
    return {
        id,
        mblogid: toText(raw.mblogid),
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        author: {
            id: toText(user.id),
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
            isVerified: user.verified === true,
            // 转发列表不提供关注入口：这里恒为未关注，避免前端据此显示关注按钮
            isFollowing: false,
        },
        // 点赞口径与主贴一致：计数取 attitudes_count，点赞态取 attitudes_status
        likes: readLikeCount(raw),
        isLiked: readIsLiked(raw),
        // 原微博的赞数是另一份数据：转发列表里条目自身几乎都是 0，展示它才有参考价值
        originalLikes: retweeted === null ? null : readLikeCount(retweeted),
        source: stripTags(toText(raw.source)),
    }
}

/** 拉取某条微博的转发列表：返回本页转发与是否还有下一页 */
export async function fetchPostReposts(options: FetchRepostsOptions): Promise<WeiboRepostsResult> {
    const page = clampPage(options.page)
    const count = clampRepostCount(options.count)
    let response: Response
    try {
        response = await fetch(buildRepostsUrl({ ...options, page, count }), {
            method: 'GET',
            headers: {
                Cookie: options.cookie,
                Referer: WEIBO_WEB_REFERER,
                'User-Agent': WEIBO_WEB_USER_AGENT,
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '转发列表请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '转发列表读取过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `转发列表请求失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '转发列表返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '转发列表返回结构异常', response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        throw new WeiboWebError('upstream', `转发列表读取失败：${message}`, response.status)
    }

    const list = Array.isArray(parsed.data) ? parsed.data : []
    const reposts: WeiboRepostItem[] = []
    for (const item of list) {
        const repost = normalizeWebRepost(item)
        if (repost !== null) {
            reposts.push(repost)
        }
    }
    return { reposts, page, hasMore: reposts.length >= count }
}

/**
 * 提交转发表单：走登录 Cookie 与 X-XSRF-TOKEN，状态码与回包判定集中在这一处。
 * 关键约束：回包 `msg` 为「转发成功」，成功判定同发布（ok > 0）；写操作不重试。
 */
async function submitRepostForm(
    subject: string,
    cookie: string,
    form: URLSearchParams,
    timeoutMs: number,
): Promise<void> {
    const headers: Record<string, string> = {
        Cookie: cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }
    const xsrfToken = readXsrfToken(cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${WEIBO_AJAX_PATHS.normalRepost}`, {
            method: 'POST',
            headers,
            body: form.toString(),
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch {
        throw new WeiboWebError('network', `${subject}失败：请检查网络或代理设置`)
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `${subject}失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', `${subject}返回无法解析：接口可能已改版`, response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', `${subject}返回结构异常`, response.status)
    }
    const ok = parsed.ok
    if (typeof ok !== 'number' || ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `${subject}失败：${message}`, response.status)
    }
}

/**
 * 转发微博：网页版 normal_repost 表单提交，与评论发布一样走登录 Cookie 与 X-XSRF-TOKEN。
 * 复用约定：错误分类沿用 WeiboWebError；附言直接按文本提交，表情以 `[名称]` 交给上游转图片。
 * 关键约束：附言可为空（纯转发）；三种方式按实测参数分支——
 * 只转发与转发并评论都走 normal_repost，带 visible / share_id（is_comment 分别为 0 / 1）；
 * 评论并转发走 comments/create 的 is_repost=1，一次请求同时生成评论与转发
 * （回包 data.repostId 即转发 id，不需要第二次请求）；
 * 回包缺 repostId 时按部分成功返回 { reposted: false, commented: true, failureMessage }，
 * 避免用户重试把同一条评论发重；写操作不重试。
 */
export async function createPostRepost(options: CreateRepostOptions): Promise<WeiboRepostCreateResult> {
    const mode = options.mode ?? 'repost'
    const fingerprint = buildStableFingerprint(options.cookie)
    const common = { id: options.id, comment: options.comment, pic_id: '' }
    const timeoutMs = options.timeoutMs ?? MUTATE_TIMEOUT_MS

    if (mode === 'commentWithRepost') {
        // 实测：comments/create 带 is_repost=1 会一次生成「评论 + 转发」，回包 data.repostId 即转发 id，
        // 不再需要第二次 normal_repost（原先两步的失败补偿随之取消）
        const result = await createPostComment({
            cookie: options.cookie,
            id: options.id,
            text: options.comment,
            timeoutMs: options.timeoutMs,
            repost: true,
        })
        if (result.reposted === true) {
            return { reposted: true, commented: true }
        }
        // 评论已发出但回包没带转发 id：按部分成功交给前端，避免用户重试把评论发重
        return { reposted: false, commented: true, failureMessage: '评论已发布，但转发未生成' }
    }

    const isComment = mode === 'repostWithComment'
    // 字段集合照网页端实测逐项对齐：转发并评论仍带 visible 与 share_id
    const form = new URLSearchParams({
        ...common,
        is_repost: '0',
        comment_ori: '0',
        is_comment: isComment ? '1' : '0',
        visible: '0',
        share_id: '',
        fp: fingerprint,
    })
    await submitRepostForm(isComment ? '转发并评论' : '转发', options.cookie, form, timeoutMs)
    // 转发并评论虽是一条过，但回包只给 data.statuses（新建转发），不含评论 id，
    // 因此 commented 只能按传参声明；客户端无法核实评论是否真的落地，不要把它当事实。
    return { reposted: true, commented: isComment }
}

/**
 * 删除微博（含转发）：网页版 statuses/destroy 表单提交，只带微博 id。
 * 关键约束：回包不是 { ok, data } 包装，而是被删除的微博对象本身、末尾才带 ok，
 * 因此只有 ok 明确不大于 0 才算失败；ok 缺失但回包带 id 时视为成功；
 * 归属由上游判定（前端只给自己的转发 / 微博放入口）；写操作不重试。
 */
export async function destroyPostStatus(options: DestroyStatusOptions): Promise<WeiboDestroyStatusResult> {
    const headers: Record<string, string> = {
        Cookie: options.cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }
    const xsrfToken = readXsrfToken(options.cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }
    const form = new URLSearchParams({ id: options.id })

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${WEIBO_AJAX_PATHS.destroyStatus}`, {
            method: 'POST',
            headers,
            body: form.toString(),
            signal: AbortSignal.timeout(options.timeoutMs ?? MUTATE_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '删除失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `删除失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '删除返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '删除返回结构异常', response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `删除失败：${message}`, response.status)
    }
    return { deleted: true }
}
